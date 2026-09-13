/**
 * 官网聊天服务（基于既有 /ws 通道）
 *  - 公屏：所有在线用户可见，纵向滚动
 *  - 私聊：点对点，仅双方可见
 *  - 气泡：用户可购买气泡样式，发言时携带
 *
 * 复用 lib/realtime.js 的连接池（clients: userId -> Set<ws>）
 * 前端协议（JSON）：
 *   发送：{ type:'chat', channel:'public'|'dm', to?:userId, content:'文本', bubbleId?:number }
 *   接收：{ type:'chat', ...消息体 }
 *   历史：{ type:'chat_history', channel, messages:[...] }
 *   错误：{ type:'chat_error', error:'...' }
 */
const WebSocket = require('ws');
const db = require('../database');
const logger = require('./logger');
const { clients } = require('./realtime');
const chatUpload = require('./chat-upload');

const MAX_LEN = 500;          // 单条消息最大长度
const HISTORY_LIMIT = 50;     // 拉取历史条数
const RATE_WINDOW_MS = 5000;  // 限流窗口
const RATE_MAX = 8;           // 窗口内最多条数

// ---- 媒体保留策略（可用 .env 覆盖）----
// 私聊图片/语音：到期后整条消息连同对象存储文件一起删除
const dmMediaDays = () => {
    const n = parseInt(process.env.CHAT_DM_MEDIA_RETENTION_DAYS || '', 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
};
// 公屏图片/语音：超过保留期后仅回收媒体文件，消息文本保留
const publicMediaDays = () => {
    const n = parseInt(process.env.CHAT_PUBLIC_MEDIA_RETENTION_DAYS || '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 30;
};

/** 统一使用 UTC 字符串（与 chat_messages.created_at 的 CURRENT_TIMESTAMP 口径一致） */
function utcStr(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** userId -> { count, windowStart } */
const rateMap = new Map();

function rateOk(userId) {
    const now = Date.now();
    let r = rateMap.get(userId);
    if (!r || now - r.windowStart > RATE_WINDOW_MS) {
        r = { count: 0, windowStart: now };
        rateMap.set(userId, r);
    }
    r.count += 1;
    return r.count <= RATE_MAX;
}

/** 取消息里要展示的用户信息（昵称/头像/气泡/@提及） */
async function enrich(rows) {
    if (!rows.length) return [];
    const ids = [...new Set(rows.flatMap(r => [r.sender_id, r.receiver_id]).filter(Boolean))];
    // 收集 @提及 的用户 ID（mention_ids 逗号分隔）
    const mentionIdSet = new Set();
    rows.forEach(r => {
        if (r.mention_ids) String(r.mention_ids).split(',').forEach(x => { const n = parseInt(x); if (n) mentionIdSet.add(n); });
    });
    mentionIdSet.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    const ph = ids.map(() => '?').join(',');
    const users = ids.length
        ? await db.all(`SELECT id, username, nickname, avatar FROM users WHERE id IN (${ph})`, ids)
        : [];
    const umap = new Map(users.map(u => [u.id, u]));
    // 气泡样式
    const bubbleIds = [...new Set(rows.map(r => r.bubble_id).filter(Boolean))];
    let bmap = new Map();
    if (bubbleIds.length) {
        const bph = bubbleIds.map(() => '?').join(',');
        const bs = await db.all(`SELECT * FROM chat_bubbles WHERE id IN (${bph})`, bubbleIds);
        bmap = new Map(bs.map(b => [b.id, b]));
    }
    return rows.map(r => {
        const su = umap.get(r.sender_id) || {};
        const ru = umap.get(r.receiver_id) || {};
        const b = bmap.get(r.bubble_id) || null;
        const mentionIds = r.mention_ids ? String(r.mention_ids).split(',').map(x => parseInt(x)).filter(Boolean) : [];
        const mentions = mentionIds.map(mid => {
            const mu = umap.get(mid) || {};
            return { id: mid, username: mu.username || '', nickname: mu.nickname || '用户' };
        });
        return {
            id: r.id,
            channel: r.channel,
            content: r.content,
            imageUrl: r.image_url || null,
            stickerUrl: r.sticker_url || null,
            voiceUrl: r.voice_url || null,
            voiceDuration: r.voice_duration || null,
            expiresAt: r.expires_at || null,
            createdAt: r.created_at,
            sender: { id: r.sender_id, username: su.username || '', nickname: su.nickname || '用户', avatar: su.avatar || '' },
            receiver: r.receiver_id ? { id: r.receiver_id, username: ru.username || '', nickname: ru.nickname || '用户', avatar: ru.avatar || '' } : null,
            bubble: b ? { id: b.id, name: b.name, bgColor: b.bg_color, textColor: b.text_color, borderColor: b.border_color || '' } : null,
            mentions,
        };
    });
}

/** 取公屏历史 */
async function publicHistory(limit = HISTORY_LIMIT) {
    const rows = await db.all(
        `SELECT * FROM chat_messages WHERE channel='public' ORDER BY id DESC LIMIT ?`, [limit]
    );
    const list = await enrich(rows.reverse());
    return list;
}

/** 取与某用户的私聊历史（过滤已过期消息） */
async function dmHistory(userId, otherId, limit = HISTORY_LIMIT) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const rows = await db.all(
        `SELECT * FROM chat_messages
         WHERE channel='dm' AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY id DESC LIMIT ?`,
        [userId, otherId, otherId, userId, now, limit]
    );
    return enrich(rows.reverse());
}

/** 我的会话列表（最近联系人 + 最后一条消息） */
async function dmConversations(userId) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const rows = await db.all(
        `SELECT * FROM chat_messages
         WHERE channel='dm' AND (sender_id=? OR receiver_id=?)
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY id DESC LIMIT 500`,
        [userId, userId, now]
    );
    const seen = new Map();
    for (const r of rows) {
        const other = r.sender_id === userId ? r.receiver_id : r.sender_id;
        if (!other || seen.has(other)) continue;
        seen.set(other, r);
    }
    if (!seen.size) return [];
    const ids = [...seen.keys()];
    const ph = ids.map(() => '?').join(',');
    const users = await db.all(`SELECT id, username, nickname, avatar FROM users WHERE id IN (${ph})`, ids);
    const umap = new Map(users.map(u => [u.id, u]));
    const out = [];
    for (const [other, lastMsg] of seen) {
        const u = umap.get(other);
        if (!u) continue;
        out.push({
            userId: other,
            nickname: u.nickname || u.username || '用户',
            username: u.username || '',
            avatar: u.avatar || '',
            lastMessage: lastMsg.content,
            lastAt: lastMsg.created_at,
        });
    }
    return out;
}

/**
 * 聊天媒体清理（对象存储 + 数据库双删，避免七牛只增不减）
 *
 *  1) 私聊媒体：到达 expires_at 后「整条消息删除」，同时删除其在对象存储中的文件
 *  2) 公屏媒体：超过 CHAT_PUBLIC_MEDIA_RETENTION_DAYS 天后「只回收媒体文件」，
 *     消息本身保留（内容替换为 [图片已过期]/[语音已过期]），避免聊天记录出现空洞
 *
 *  说明：表情包（sticker_url）属于用户资产（chat_stickers / chat_stickers_public 长期引用），
 *        不随消息回收，避免误删用户仍在使用的表情。
 *
 * @returns {Promise<{dmDeleted:number, mediaStripped:number, objectsDeleted:number, objectsMissing:number, objectsFailed:number}>}
 */
async function cleanupExpired(opts = {}) {
    const result = { dmDeleted: 0, mediaStripped: 0, objectsDeleted: 0, objectsMissing: 0, objectsFailed: 0 };
    const now = utcStr(Date.now());
    const days = Number.isFinite(opts.publicRetentionDays) ? opts.publicRetentionDays : publicMediaDays();
    const publicCutoff = utcStr(Date.now() - days * 24 * 3600 * 1000);

    // ---- 1) 私聊：已到过期时间 → 整条删除（含对象存储文件）----
    if (opts.skipDm !== true) {
        const dmRows = await db.all(
            `SELECT id, image_url, voice_url FROM chat_messages
             WHERE channel='dm' AND expires_at IS NOT NULL AND expires_at <= ?`,
            [now]
        );
        if (dmRows.length) {
            const del = await chatUpload.deleteByUrls(dmRows.flatMap(r => [r.image_url, r.voice_url]));
            result.objectsDeleted += del.deleted;
            result.objectsMissing += del.missing;
            result.objectsFailed += del.failed;
            const ids = dmRows.map(r => r.id);
            const r = await db.run(
                `DELETE FROM chat_messages WHERE id IN (${ids.map(() => '?').join(',')})`,
                ids
            );
            result.dmDeleted = r.changes || dmRows.length;
        }
    }

    // ---- 2) 公屏：超过保留期 → 回收媒体文件，消息保留 ----
    if (days > 0 && opts.skipPublic !== true) {
        const pubRows = await db.all(
            `SELECT id, image_url, voice_url FROM chat_messages
             WHERE channel='public' AND (image_url IS NOT NULL OR voice_url IS NOT NULL)
               AND created_at <= ?`,
            [publicCutoff]
        );
        if (pubRows.length) {
            const del = await chatUpload.deleteByUrls(pubRows.flatMap(r => [r.image_url, r.voice_url]));
            result.objectsDeleted += del.deleted;
            result.objectsMissing += del.missing;
            result.objectsFailed += del.failed;
            for (const row of pubRows) {
                const placeholder = row.image_url ? '[图片已过期]' : '[语音已过期]';
                // eslint-disable-next-line no-await-in-loop
                await db.run(
                    `UPDATE chat_messages
                     SET image_url = NULL, voice_url = NULL,
                         content = CASE WHEN content IN ('[图片]', '[语音]') THEN ? ELSE content END
                     WHERE id = ?`,
                    [placeholder, row.id]
                );
            }
            result.mediaStripped = pubRows.length;
        }
    }

    return result;
}

/** 判断清理结果是否为空（供定时任务决定是否打日志） */
function cleanupIsEmpty(r) {
    return !r || (!r.dmDeleted && !r.mediaStripped && !r.objectsDeleted && !r.objectsFailed);
}

/** 广播给所有在线用户 */
function broadcastAll(payload) {
    const msg = JSON.stringify(payload);
    let n = 0;
    for (const set of clients.values()) {
        for (const ws of set) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(msg); n++; } catch (e) { /* 忽略单连接错误 */ }
            }
        }
    }
    return n;
}

/** 发给指定两个用户（私聊双方） */
function sendToUsers(ids, payload) {
    const msg = JSON.stringify(payload);
    let n = 0;
    for (const id of ids) {
        const set = clients.get(id);
        if (!set) continue;
        for (const ws of set) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(msg); n++; } catch (e) { /* 忽略 */ }
            }
        }
    }
    return n;
}

/** 校验并去重 @提及 的用户 ID（前端通过 @ 选择器传入，后端兜底按文本解析） */
async function resolveMentions(text, mentionIdsRaw, senderId) {
    const ids = new Set();
    // 前端显式传入的 mentions
    if (Array.isArray(mentionIdsRaw)) {
        mentionIdsRaw.forEach(x => { const n = parseInt(x); if (n && n !== senderId) ids.add(n); });
    }
    // 兜底：从文本解析 @昵称/@用户名（仅无空格昵称可可靠解析）
    const tokens = [...new Set((text.match(/@[\w\u4e00-\u9fa5.-]{1,30}/g) || []).map(t => t.slice(1)))];
    if (tokens.length) {
        const ph = tokens.map(() => '?').join(',');
        const rows = await db.all(
            `SELECT id FROM users WHERE id != ? AND (username IN (${ph}) OR nickname IN (${ph})) LIMIT 20`,
            [senderId, ...tokens]
        );
        rows.forEach(r => ids.add(r.id));
    }
    const list = [...ids];
    // 校验真实存在
    if (!list.length) return [];
    const ph = list.map(() => '?').join(',');
    const ok = await db.all(`SELECT id FROM users WHERE id IN (${ph})`, list);
    return ok.map(r => r.id);
}

/** 聊天相关通知（私聊 / 被@提及），站内 + Web Push 系统级弹窗 */
function notifyChat({ toUserId, type, title, content, actorId, url }) {
    try {
        const { createNotification } = require('../routes/notifications');
        createNotification({ userId: toUserId, type, title, content, actorId, url })
            .catch(e => logger.error('聊天通知失败:', e.message));
    } catch (e) {
        logger.error('聊天通知发送异常:', e.message);
    }
}

/** 处理一条聊天消息（由 realtime 的 ws.on('message') 调用） */
async function handleMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    const userId = ws.userId;
    if (!userId) return;

    const sendErr = (error) => { try { ws.send(JSON.stringify({ type: 'chat_error', error })); } catch (e) {} };

    // 拉取历史
    if (m.type === 'chat_history') {
        try {
            if (m.channel === 'dm' && m.with) {
                const msgs = await dmHistory(userId, parseInt(m.with));
                ws.send(JSON.stringify({ type: 'chat_history', channel: 'dm', with: parseInt(m.with), messages: msgs }));
            } else {
                const msgs = await publicHistory();
                ws.send(JSON.stringify({ type: 'chat_history', channel: 'public', messages: msgs }));
            }
        } catch (e) { sendErr('读取历史失败'); }
        return;
    }

    if (m.type !== 'chat') return;

    if (!rateOk(userId)) return sendErr('发言过于频繁，请稍后再试');

    // 媒体消息：imageUrl / stickerUrl / voiceUrl 三选一，可为纯文本
    const imageUrl = m.imageUrl ? String(m.imageUrl).slice(0, 500) : null;
    const stickerUrl = m.stickerUrl ? String(m.stickerUrl).slice(0, 500) : null;
    const voiceUrl = m.voiceUrl ? String(m.voiceUrl).slice(0, 500) : null;
    const isMedia = !!(imageUrl || stickerUrl || voiceUrl);
    let voiceDuration = m.duration ? Math.min(parseInt(m.duration) || 0, 60) : null;

    const contentRaw = String(m.content == null ? '' : m.content).trim();
    const content = contentRaw || (imageUrl ? '[图片]' : stickerUrl ? '[表情]' : voiceUrl ? '[语音]' : '');
    if (!content) return sendErr('内容不能为空');
    if (content.length > MAX_LEN) return sendErr(`内容过长（最多 ${MAX_LEN} 字）`);

    const channel = m.channel === 'dm' ? 'dm' : 'public';

    // 气泡：校验该用户是否拥有（拥有才生效，默认气泡 bubbleId=0 或未传则不带）
    let bubbleId = m.bubbleId ? parseInt(m.bubbleId) : null;
    if (bubbleId) {
        const owned = await db.get(
            'SELECT b.id FROM user_bubbles ub JOIN chat_bubbles b ON b.id = ub.bubble_id WHERE ub.user_id=? AND ub.bubble_id=?',
            [userId, bubbleId]
        );
        if (!owned) bubbleId = null;
    }

    // 私聊媒体（图片/语音）：N 天后过期，到期由清理任务删除（数据库行 + 对象存储文件）
    const expiresAt = (channel === 'dm' && (imageUrl || voiceUrl))
        ? utcStr(Date.now() + dmMediaDays() * 24 * 3600 * 1000)
        : null;

    // @提及：仅公屏支持（私聊 1 对 1 无需提及）
    let mentionIds = [];
    if (channel === 'public') {
        mentionIds = await resolveMentions(contentRaw, m.mentions, userId);
    }
    const mentionIdsStr = mentionIds.length ? mentionIds.join(',') : null;

    try {
        if (channel === 'dm') {
            const to = parseInt(m.to);
            if (!to) return sendErr('缺少私聊对象');
            if (to === userId) return sendErr('不能给自己发私聊');
            const target = await db.get('SELECT id FROM users WHERE id=?', [to]);
            if (!target) return sendErr('对方不存在');

            const r = await db.run(
                `INSERT INTO chat_messages (channel, sender_id, receiver_id, content, bubble_id, image_url, sticker_url, voice_url, voice_duration, expires_at)
                 VALUES ('dm', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, to, content, bubbleId, imageUrl, stickerUrl, voiceUrl, voiceDuration, expiresAt]
            );
            const row = await db.get('SELECT * FROM chat_messages WHERE id=?', [r.id]);
            const [dto] = await enrich([row]);
            sendToUsers([userId, to], { type: 'chat', ...dto });

            // 私聊：给接收方发系统级通知（站内 + Web Push）
            const preview = imageUrl ? '[图片]' : stickerUrl ? '[表情]' : voiceUrl ? '[语音]' : content.slice(0, 40);
            notifyChat({
                toUserId: to,
                type: 'chat',
                title: '新私聊消息',
                content: `${dto.sender.nickname || dto.sender.username}：${preview}`,
                actorId: userId,
                url: `/chat/${userId}`,
            });
        } else {
            const r = await db.run(
                `INSERT INTO chat_messages (channel, sender_id, receiver_id, content, bubble_id, image_url, sticker_url, voice_url, voice_duration, mention_ids)
                 VALUES ('public', ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, content, bubbleId, imageUrl, stickerUrl, voiceUrl, voiceDuration, mentionIdsStr]
            );
            const row = await db.get('SELECT * FROM chat_messages WHERE id=?', [r.id]);
            const [dto] = await enrich([row]);
            broadcastAll({ type: 'chat', ...dto });

            // 被@提及：给每位被提及用户发通知
            if (mentionIds.length) {
                const senderName = dto.sender.nickname || dto.sender.username;
                const mPreview = imageUrl ? '[图片]' : stickerUrl ? '[表情]' : voiceUrl ? '[语音]' : content.slice(0, 40);
                mentionIds.forEach(mid => {
                    notifyChat({
                        toUserId: mid,
                        type: 'chat_mention',
                        title: '在公屏被@了',
                        content: `${senderName}：${mPreview}`,
                        actorId: userId,
                        url: '/',
                    });
                });
            }
        }
    } catch (e) {
        logger.error('聊天消息处理失败:', e.message);
        sendErr('发送失败');
    }
}

/** 在线用户数 */
function onlineCount() {
    return clients.size;
}

module.exports = { handleMessage, publicHistory, dmHistory, dmConversations, cleanupExpired, cleanupIsEmpty, broadcastAll, sendToUsers, onlineCount, enrich, dmMediaDays, publicMediaDays };
