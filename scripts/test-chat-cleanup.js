/**
 * 本地验证：聊天媒体清理逻辑（不依赖七牛凭证）
 *  - keyFromUrl 解析
 *  - cleanupExpired 的数据库行为（私聊整条删除 / 公屏仅剥离媒体）
 * 用法：node scripts/test-chat-cleanup.js
 */
const path = require('path');
const fs = require('fs');

// 先加载 .env，再 require 相关模块（lib/chat-upload.js 在模块加载时读取七牛凭证）
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const TEST_DB = path.join(__dirname, '..', 'data', 'cleanup-test.db');
process.env.DB_FILE = TEST_DB;
for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

const db = require(path.join(__dirname, '..', 'database'));
const chatUpload = require(path.join(__dirname, '..', 'lib', 'chat-upload'));
const chat = require(path.join(__dirname, '..', 'lib', 'chat'));

const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const DAY = 86400000;

function assert(cond, msg) {
    if (!cond) { console.error('  [FAIL] ' + msg); process.exitCode = 1; }
    else console.log('  [ok] ' + msg);
}

(async () => {
    console.log('=== 1) keyFromUrl 解析 ===');
    assert(chatUpload.keyFromUrl('https://cdn.xuanjian.top/chat/images/a.jpg') === 'chat/images/a.jpg', 'CDN URL → key');
    assert(chatUpload.keyFromUrl('https://evil.example.com/chat/images/a.jpg') === null, '外部域名被拒绝');
    assert(chatUpload.keyFromUrl('chat/voices/b.webm') === 'chat/voices/b.webm', '纯 key 原样返回');
    assert(chatUpload.keyFromUrl('') === null, '空值返回 null');
    assert(chatUpload.keyFromUrl(null) === null, 'null 返回 null');

    console.log('=== 2) 准备测试数据 ===');
    await db.run(`CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        sender_id INTEGER,
        receiver_id INTEGER,
        content TEXT,
        bubble_id INTEGER,
        image_url TEXT,
        sticker_url TEXT,
        voice_url TEXT,
        voice_duration INTEGER,
        mention_ids TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // A: 私聊过期图片（应整条删除）
    await db.run(
        `INSERT INTO chat_messages (channel, sender_id, receiver_id, content, image_url, expires_at, created_at)
         VALUES ('dm', 1, 2, '[图片]', 'https://cdn.xuanjian.top/chat/images/expired.jpg', ?, ?)`,
        [utc(Date.now() - DAY), utc(Date.now() - 4 * DAY)]
    );
    // B: 私聊未过期图片（应保留）
    await db.run(
        `INSERT INTO chat_messages (channel, sender_id, receiver_id, content, image_url, expires_at, created_at)
         VALUES ('dm', 1, 2, '[图片]', 'https://cdn.xuanjian.top/chat/images/fresh.jpg', ?, ?)`,
        [utc(Date.now() + DAY), utc(Date.now())]
    );
    // C: 公屏老旧图片（应剥离媒体、保留消息）
    await db.run(
        `INSERT INTO chat_messages (channel, sender_id, content, image_url, created_at)
         VALUES ('public', 1, '[图片]', 'https://cdn.xuanjian.top/chat/images/old.jpg', ?)`,
        [utc(Date.now() - 40 * DAY)]
    );
    // D: 公屏老旧语音（应剥离媒体）
    await db.run(
        `INSERT INTO chat_messages (channel, sender_id, content, voice_url, created_at)
         VALUES ('public', 1, '[语音]', 'https://cdn.xuanjian.top/chat/voices/old.webm', ?)`,
        [utc(Date.now() - 40 * DAY)]
    );
    // E: 公屏老旧「表情包」（不应动，属于用户资产）
    await db.run(
        `INSERT INTO chat_messages (channel, sender_id, content, sticker_url, created_at)
         VALUES ('public', 1, '[表情]', 'https://cdn.xuanjian.top/chat/stickers/keep.png', ?)`,
        [utc(Date.now() - 40 * DAY)]
    );
    // F: 公屏近期图片（应保留）
    await db.run(
        `INSERT INTO chat_messages (channel, sender_id, content, image_url, created_at)
         VALUES ('public', 1, '[图片]', 'https://cdn.xuanjian.top/chat/images/new.jpg', ?)`,
        [utc(Date.now())]
    );
    // G: 公屏老旧纯文本（不应动）
    await db.run(
        `INSERT INTO chat_messages (channel, sender_id, content, created_at)
         VALUES ('public', 1, '老消息', ?)`,
        [utc(Date.now() - 90 * DAY)]
    );

    console.log('=== 3) 执行 cleanupExpired（默认策略 私聊3天/公屏30天）===');
    const r = await chat.cleanupExpired();
    console.log('  结果:', JSON.stringify(r));

    console.log('=== 4) 断言数据库状态 ===');
    const rows = await db.all('SELECT id, channel, content, image_url, voice_url, sticker_url FROM chat_messages ORDER BY id');
    const byId = Object.fromEntries(rows.map(x => [x.id, x]));

    assert(!byId[1], 'A 私聊过期图片 → 整条已删除');
    assert(!!byId[2], 'B 私聊未过期图片 → 保留');
    assert(!!byId[3] && byId[3].image_url === null && byId[3].content === '[图片已过期]', 'C 公屏老旧图片 → 媒体已剥离、内容变占位');
    assert(!!byId[4] && byId[4].voice_url === null && byId[4].content === '[语音已过期]', 'D 公屏老旧语音 → 媒体已剥离、内容变占位');
    assert(!!byId[5] && byId[5].sticker_url !== null, 'E 公屏表情包 → 未被动（用户资产）');
    assert(!!byId[6] && byId[6].image_url !== null, 'F 公屏近期图片 → 保留');
    assert(!!byId[7] && byId[7].content === '老消息', 'G 公屏老旧纯文本 → 保留');

    assert(r.dmDeleted === 1, 'dmDeleted 统计 = 1');
    assert(r.mediaStripped === 2, 'mediaStripped 统计 = 2');
    assert(chat.cleanupIsEmpty(r) === false, 'cleanupIsEmpty(有清理) = false');
    // 配好七牛凭证时，应真实走完删除链路（测试用的 key 不存在 → 记为 missing）
    if (chatUpload.ready()) {
        assert(r.objectsFailed === 0, '对象存储删除无失败记录（凭证已配置）');
        assert(r.objectsMissing === 3, '3 个不存在的测试对象被识别为 missing（SDK 612 分支正常）');
    } else {
        console.log('  [skip] 未配置七牛凭证，跳过对象存储链路断言');
    }

    console.log('=== 5) 幂等性：再跑一次应无操作 ===');
    const r2 = await chat.cleanupExpired();
    console.log('  结果:', JSON.stringify(r2));
    assert(chat.cleanupIsEmpty(r2) === true, '第二次执行无任何清理（幂等）');

    console.log('=== 6) 保留策略可配置 ===');
    assert(chat.dmMediaDays() === 3, '默认私聊保留 3 天');
    assert(chat.publicMediaDays() === 30, '默认公屏保留 30 天');
    process.env.CHAT_PUBLIC_MEDIA_RETENTION_DAYS = '7';
    assert(chat.publicMediaDays() === 7, '可通过环境变量覆盖为 7 天');
    process.env.CHAT_PUBLIC_MEDIA_RETENTION_DAYS = '0';
    const r3 = await chat.cleanupExpired();
    assert(chat.publicMediaDays() === 0 && r3.mediaStripped === 0, '设为 0 表示不清理公屏媒体');

    console.log(process.exitCode ? '\n=== 存在失败用例 ===' : '\n=== 全部通过 ===');
    db.close();
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 忽略 */ }
    }
    process.exit(process.exitCode || 0);
})().catch(e => {
    console.error('测试异常:', e.stack || e.message);
    process.exit(1);
});
