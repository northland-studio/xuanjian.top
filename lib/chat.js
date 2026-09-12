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

const MAX_LEN = 500;          // 单条消息最大长度
const HISTORY_LIMIT = 50;     // 拉取历史条数
const RATE_WINDOW_MS = 5000;  // 限流窗口
const RATE_MAX = 8;           // 窗口内最多条数

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

/** 取消息里要展示的用户信息（昵称/头像/气泡） */
async function enrich(rows) {
    if (!rows.length) return [];
    const ids = [...new Set(rows.flatMap(r => [r.sender_id, r.receiver_id]).filter(Boolean))];
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

/** 清理已过期的私聊图片消息（返回删除条数） */
async function cleanupExpired() {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const r = await db.run(
        `DELETE FROM chat_messages WHERE expires_at IS NOT NULL AND expires_at <= ?`,
        [now]
    );
    return r.changes || 0;
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

    // 私聊图片：3 天后过期（到期由清理任务删除，读取时也会过滤）
    const expiresAt = (channel === 'dm' && imageUrl)
        ? new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')
        : null;

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
        } else {
            const r = await db.run(
                `INSERT INTO chat_messages (channel, sender_id, receiver_id, content, bubble_id, image_url, sticker_url, voice_url, voice_duration)
                 VALUES ('public', ?, NULL, ?, ?, ?, ?, ?, ?)`,
                [userId, content, bubbleId, imageUrl, stickerUrl, voiceUrl, voiceDuration]
            );
            const row = await db.get('SELECT * FROM chat_messages WHERE id=?', [r.id]);
            const [dto] = await enrich([row]);
            broadcastAll({ type: 'chat', ...dto });
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

module.exports = { handleMessage, publicHistory, dmHistory, dmConversations, cleanupExpired, broadcastAll, sendToUsers, onlineCount, enrich };
