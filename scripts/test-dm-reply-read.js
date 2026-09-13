/**
 * 本地验证：私聊「回复引用」与「已读回执」后端逻辑
 * 用法：node scripts/test-dm-reply-read.js
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const TEST_DB = path.join(__dirname, '..', 'data', 'dm-test.db');
process.env.DB_FILE = TEST_DB;
for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

const db = require(path.join(__dirname, '..', 'database'));
const chat = require(path.join(__dirname, '..', 'lib', 'chat'));
const { clients } = require(path.join(__dirname, '..', 'lib', 'realtime'));

function assert(cond, msg) {
    if (!cond) { console.error('  [FAIL] ' + msg); process.exitCode = 1; }
    else console.log('  [ok] ' + msg);
}

/** 伪造一个 ws 连接，捕获服务端下发 */
function fakeWs(userId) {
    return {
        userId,
        readyState: 1, // WebSocket.OPEN
        sent: [],
        send(s) { this.sent.push(JSON.parse(s)); },
    };
}

(async () => {
    console.log('=== 1) 建表 ===');
    await db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT, nickname TEXT, avatar TEXT, level INTEGER DEFAULT 0, contribution INTEGER DEFAULT 0
    )`);
    await db.run(`CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        sender_id INTEGER, receiver_id INTEGER,
        content TEXT, bubble_id INTEGER,
        image_url TEXT, sticker_url TEXT, voice_url TEXT, voice_duration INTEGER,
        mention_ids TEXT, expires_at DATETIME, reply_to_id INTEGER, read_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run(`CREATE TABLE user_bubbles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bubble_id INTEGER)`);
    await db.run(`CREATE TABLE chat_bubbles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, bg_color TEXT, text_color TEXT, border_color TEXT, price INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)`);
    await db.run(`CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, content TEXT,
        post_id INTEGER, comment_id INTEGER, actor_id INTEGER, is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run(`CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, endpoint TEXT, subscription_json TEXT)`);
    await db.run(`INSERT INTO users (id, username, nickname) VALUES (1,'alice','爱丽丝'),(2,'bob','鲍勃')`);
    console.log('  [ok] 测试库就绪（用户 1=爱丽丝 / 2=鲍勃）');

    const wsA = fakeWs(1);
    const wsB = fakeWs(2);
    // 注册进 realtime 的连接池，sendToUsers/broadcastAll 才能找到它们
    clients.set(1, new Set([wsA]));
    clients.set(2, new Set([wsB]));

    console.log('=== 2) 发消息 → 默认未读 ===');
    await chat.handleMessage(wsA, JSON.stringify({ type: 'chat', channel: 'dm', to: 2, content: '第一条' }));
    const first = wsB.sent.find(x => x.type === 'chat');
    assert(!!first, 'B 收到了消息广播');
    assert(first.readAt === null, '新消息 readAt 为 null（未读）');
    const firstId = first.id;

    console.log('=== 3) 回复引用 ===');
    await chat.handleMessage(wsB, JSON.stringify({ type: 'chat', channel: 'dm', to: 1, content: '回复你', replyTo: firstId }));
    const reply = wsA.sent.filter(x => x.type === 'chat').pop();
    assert(!!reply.replyTo, '回复消息带上了 replyTo');
    assert(reply.replyTo && reply.replyTo.id === firstId, 'replyTo.id 指向原消息');
    assert(reply.replyTo && reply.replyTo.senderName === '爱丽丝', 'replyTo.senderName = 爱丽丝');
    assert(reply.replyTo && reply.replyTo.preview === '第一条', 'replyTo.preview 为原消息摘要');

    console.log('=== 4) 跨会话引用应被拒绝（降级为普通消息）===');
    // 造第三个用户，构造一个不属于本会话的消息
    await db.run(`INSERT INTO users (id, username, nickname) VALUES (3,'carol','卡罗尔')`);
    await db.run(
        `INSERT INTO chat_messages (channel, sender_id, receiver_id, content) VALUES ('dm', 1, 3, '私密内容')`
    );
    const foreign = await db.get(`SELECT id FROM chat_messages WHERE content='私密内容'`);
    wsB.sent.length = 0;
    await chat.handleMessage(wsB, JSON.stringify({ type: 'chat', channel: 'dm', to: 1, content: '非法引用', replyTo: foreign.id }));
    const bad = wsB.sent.find(x => x.type === 'chat');
    assert(bad && bad.replyTo === null, '跨会话 replyTo 被丢弃（replyTo=null）');

    console.log('=== 5) 已读回执 ===');
    // A 读取与 B 的会话：B→A 共 2 条（步骤3的回复 + 步骤4的非法引用），均为未读
    const unreadBefore = await chat.dmUnreadTotal(1);
    assert(unreadBefore === 2, `A 有 2 条未读（实际 ${unreadBefore}）`);
    const r = await chat.markDmRead(1, 2);
    assert(r.count === 2, `markDmRead 标记 2 条（实际 ${r.count}）`);
    assert(r.ids.includes(reply.id), 'messageIds 包含 B 回复给 A 的那条');
    assert(await chat.dmUnreadTotal(1) === 0, '标记后 A 未读归零');

    const reread = await chat.markDmRead(1, 2);
    assert(reread.count === 0, '重复标记返回 0（幂等）');

    console.log('=== 6) 已读状态出现在历史里 ===');
    const hist = await chat.dmHistory(1, 2, 50);
    const bMsg = hist.find(x => x.id === reply.id);
    assert(bMsg && !!bMsg.readAt, 'B 的消息 readAt 已落库并返回');
    const aMsg = hist.find(x => x.id === firstId);
    assert(aMsg && aMsg.readAt === null, 'A 的消息仍未读（对方还没读）');

    console.log('=== 7) 会话列表未读统计 ===');
    // B 视角：A 发给 B 的那条（firstId）未读
    const convsB = await chat.dmConversations(2);
    const cA = convsB.find(c => c.userId === 1);
    assert(!!cA, 'B 的会话列表里有与爱丽丝的会话');
    assert(cA.unread === 1, `B 的未读数为 1（实际 ${cA.unread}）`);
    assert(cA.lastFromMe === false || cA.lastFromMe === true, 'lastFromMe 字段存在');
    assert(await chat.dmUnreadTotal(2) === 1, 'dmUnreadTotal(2) = 1');

    // A 视角：已全部读过
    assert(await chat.dmUnreadTotal(1) === 0, 'dmUnreadTotal(1) = 0');

    console.log('=== 8) 已读后未读数归零 ===');
    await chat.markDmRead(2, 1);
    assert(await chat.dmUnreadTotal(2) === 0, 'B 读完后未读数归零');
    const convsB2 = await chat.dmConversations(2);
    const cA2 = convsB2.find(c => c.userId === 1);
    assert(cA2.unread === 0 && cA2.lastRead === true, '会话列表 lastRead=true（我发的最后一条已被读）');

    console.log('=== 9) chat_read 协议（经 handleMessage 分发）===');
    // B 给 A 发一条，A 通过 WS 上报已读，双方都应收到 chat_read
    wsB.sent.length = 0; wsA.sent.length = 0;
    await chat.handleMessage(wsB, JSON.stringify({ type: 'chat', channel: 'dm', to: 1, content: '新消息' }));
    await chat.handleMessage(wsA, JSON.stringify({ type: 'chat_read', channel: 'dm', with: 2 }));
    const ackForB = wsB.sent.find(x => x.type === 'chat_read');
    const ackForA = wsA.sent.find(x => x.type === 'chat_read');
    assert(!!ackForB, '发送方 B 收到已读回执');
    assert(!!ackForA, '读取方 A 也收到（多端同步）');
    assert(ackForB && ackForB.by === 1 && ackForB.with === 2, '回执 by=1 with=2');
    assert(ackForB && Array.isArray(ackForB.messageIds) && ackForB.messageIds.length === 1, '回执带 1 条 messageId');
    assert(ackForB && !!ackForB.readAt, '回执带 readAt 时间戳');

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
