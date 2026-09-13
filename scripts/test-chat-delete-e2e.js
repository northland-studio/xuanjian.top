/**
 * 端到端验证：删除接口是否同步回收对象存储文件（项 3）
 *  1) 通过接口上传一个表情包（真实写入七牛）
 *  2) 确认七牛上存在该对象
 *  3) 通过接口删除该表情包
 *  4) 确认七牛上对象已被回收
 * 用法：node scripts/test-chat-delete-e2e.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const jwt = require('jsonwebtoken');
const qiniu = require('qiniu');

const BASE = 'http://127.0.0.1:3000';
const BUCKET = process.env.QINIU_BUCKET || 'xuanjian-top';
const token = jwt.sign({ userId: 2, username: 'morzane', level: 10 }, process.env.JWT_SECRET, { expiresIn: '10m' });

const mac = new qiniu.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);
const bm = new qiniu.rs.BucketManager(mac, new qiniu.conf.Config({ useHttpsDomain: false }));

function statKey(key) {
    return new Promise((resolve) => {
        bm.stat(BUCKET, key, (err, body, info) => resolve(!err && info && info.statusCode === 200));
    });
}

// 1x1 PNG
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

function assert(cond, msg) {
    if (!cond) { console.error('  [FAIL] ' + msg); process.exitCode = 1; }
    else console.log('  [ok] ' + msg);
}

async function api(method, url, body) {
    const headers = { Authorization: 'Bearer ' + token };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

(async () => {
    const keyOf = (url) => String(url).replace(/^https?:\/\/[^/]+\//, '');

    // ---------- 公共表情包（管理端） ----------
    console.log('=== 公共表情包：上传 → 确认存在 → 删除 → 确认回收 ===');
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 't.png');
    fd.append('name', 'e2e-test');
    const up = await api('POST', '/api/chat/admin/stickers', fd);
    assert(up.status === 201 && up.json.url, `上传成功（HTTP ${up.status}）`);
    const pubKey = keyOf(up.json.url);
    console.log('    key =', pubKey);
    assert(await statKey(pubKey), '七牛上对象确实存在');

    const del = await api('DELETE', `/api/chat/admin/stickers/${up.json.id}`);
    assert(del.status === 200 && del.json.success, `删除接口返回成功（HTTP ${del.status}）`);
    console.log('    objectsDeleted =', del.json.objectsDeleted);
    assert(del.json.objectsDeleted === 1, '接口报告回收了 1 个对象');
    assert(!(await statKey(pubKey)), '七牛上对象已被回收');

    // ---------- 个人表情包 ----------
    console.log('=== 个人表情包：上传 → 确认存在 → 删除 → 确认回收 ===');
    const fd2 = new FormData();
    fd2.append('file', new Blob([PNG], { type: 'image/png' }), 't2.png');
    const up2 = await api('POST', '/api/chat/stickers', fd2);
    assert(up2.status === 201 && up2.json.url, `上传成功（HTTP ${up2.status}）`);
    const myKey = keyOf(up2.json.url);
    console.log('    key =', myKey);
    assert(await statKey(myKey), '七牛上对象确实存在');

    const del2 = await api('DELETE', `/api/chat/stickers/${up2.json.id}`);
    assert(del2.status === 200 && del2.json.success, `删除接口返回成功（HTTP ${del2.status}）`);
    console.log('    objectsDeleted =', del2.json.objectsDeleted);
    assert(del2.json.objectsDeleted === 1, '接口报告回收了 1 个对象');
    assert(!(await statKey(myKey)), '七牛上对象已被回收');

    console.log(process.exitCode ? '\n=== 存在失败用例 ===' : '\n=== 全部通过 ===');
    process.exit(process.exitCode || 0);
})().catch((e) => { console.error('测试异常:', e.stack || e.message); process.exit(1); });
