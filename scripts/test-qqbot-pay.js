/**
 * QQ 机器人扫码支付接口 · 本地联调（官网侧）
 *
 * 覆盖：
 *  1) GET /api/pay/qr.png —— 合法链接 / 纯 token / 外部链接拒绝 / 超长拒绝 / 缺参拒绝
 *  2) /api/qqbot/pay/* —— bot token 鉴权、未绑定提示、收款码、付款码、记录、缴费单权限
 *  3) 回归：重构后的网页接口 /api/pay/receive-code、payer-code/current、records、charge 仍正常
 *
 * 用法：先启动本地服务（PORT=3999），再 node scripts/test-qqbot-pay.js 3999
 * 结束后回滚/删除测试账号与数据。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const path = require('path');

const PORT = process.argv[2] || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const BOT_TOKEN = process.env.QQBOT_TOKEN || '';
const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guild.db'));
const get = (sql, a = []) => new Promise((r, j) => db.get(sql, a, (e, x) => e ? j(e) : r(x)));
const all = (sql, a = []) => new Promise((r, j) => db.all(sql, a, (e, x) => e ? j(e) : r(x)));
const run = (sql, a = []) => new Promise((r, j) => db.run(sql, a, function (e) { e ? j(e) : r(this); }));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' · ' + extra : ''}`); }
    else { fail++; console.log(`  ✗ ${name}${extra ? ' · ' + extra : ''}`); }
}

const call = async (method, url, { body, bot = false, jwtUser = null } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (bot && BOT_TOKEN) headers['X-Bot-Token'] = BOT_TOKEN;
    if (jwtUser) headers.Authorization = 'Bearer ' + jwt.sign({ userId: jwtUser.id, level: jwtUser.level }, process.env.JWT_SECRET);
    const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('image/png')) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { status: res.status, ct, buf };
    }
    let json = null;
    try { json = await res.json(); } catch (_) { }
    return { status: res.status, ct, json };
};

/** 把响应的完整 URL 转成本地可访问的 path+query */
const localize = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '');

(async () => {
    console.log(`\n=== QQ 机器人扫码支付接口联调 @ ${BASE} ===\n`);
    if (!BOT_TOKEN) throw new Error('本地 .env 缺少 QQBOT_TOKEN，无法测试 bot 鉴权');

    // ===== 准备两个临时绑定账号：管理员 + 普通成员 =====
    const QQ_ADMIN = '900000001', QQ_USER = '900000002', QQ_UNBOUND = '900000003';
    for (const [qq, name, level, verified] of [[QQ_ADMIN, 'payqq_admin', 1, 1], [QQ_USER, 'payqq_user', 0, 0]]) {
        await run('DELETE FROM users WHERE username = ?', [name]);
        await run(
            `INSERT INTO users (username, nickname, qq, password, level, email_verified, contribution, created_at)
             VALUES (?, ?, ?, '!payqq!', ?, ?, 300, datetime('now','localtime'))`,
            [name, name, qq, level, verified]
        );
    }
    const adminUser = await get('SELECT id, username, nickname, level, email_verified FROM users WHERE username = ?', ['payqq_admin']);
    const normalUser = await get('SELECT id, username, nickname, level, email_verified FROM users WHERE username = ?', ['payqq_user']);
    const tmpIds = [adminUser.id, normalUser.id];
    console.log(`临时账号: 管理员 #${adminUser.id}(qq=${QQ_ADMIN}) | 普通 #${normalUser.id}(qq=${QQ_USER})\n`);

    const token = 'AbCdEfGhIjKlMnOpQrStUv';       // 22 位，形如真实 token
    const goodLink = `https://xuanjian.top/pay/${token}`;

    // ===== 1. QR 图片接口 =====
    const okLink = await call('GET', `/api/pay/qr.png?text=${encodeURIComponent(goodLink)}`);
    check('qr.png 合法链接 200 image/png', okLink.status === 200 && okLink.ct.includes('image/png'), `ct=${okLink.ct}`);
    check('qr.png 返回真实 PNG（魔数 89504E47）', okLink.buf?.length > 100 && okLink.buf.slice(0, 4).toString('hex') === '89504e47', `${okLink.buf?.length} bytes`);

    const okToken = await call('GET', `/api/pay/qr.png?text=${token}`);
    check('qr.png 纯 token 200', okToken.status === 200 && okToken.ct.includes('image/png'));

    const okCharge = await call('GET', `/api/pay/qr.png?text=${encodeURIComponent(`https://xuanjian.top/pay/charge/${token}`)}&size=200`);
    check('qr.png 缴费单链接 200（size 参数生效）', okCharge.status === 200, `${okCharge.buf?.length} bytes`);

    const okRelative = await call('GET', `/api/pay/qr.png?text=${encodeURIComponent(`/pay/${token}`)}`);
    check('qr.png 站内相对路径 200', okRelative.status === 200);

    const badExternal = await call('GET', `/api/pay/qr.png?text=${encodeURIComponent('https://evil.example.com/anything')}`);
    check('qr.png 外部链接拒绝 400', badExternal.status === 400, badExternal.json?.error);

    const badArbitrary = await call('GET', `/api/pay/qr.png?text=${encodeURIComponent('hello world 我是任意二维码内容')}`);
    check('qr.png 任意文本拒绝 400', badArbitrary.status === 400, badArbitrary.json?.error);

    const badLong = await call('GET', `/api/pay/qr.png?text=${token}${'A'.repeat(600)}`);
    check('qr.png 超长文本拒绝 400', badLong.status === 400, badLong.json?.error);

    const noText = await call('GET', `/api/pay/qr.png`);
    check('qr.png 缺 text 拒绝 400', noText.status === 400, noText.json?.error);

    const foreignToken = await call('GET', `/api/pay/qr.png?text=${encodeURIComponent('https://example.com/pay/' + token)}`);
    check('qr.png 非本站 https 链接拒绝 400', foreignToken.status === 400, foreignToken.json?.error);

    // ===== 2. /api/qqbot/pay/* 鉴权 =====
    const noAuth = await call('POST', '/api/qqbot/pay/receive-code', { body: { qq: QQ_USER } });
    check('机器人接口无 token → 401', noAuth.status === 401, noAuth.json?.error);

    // ===== 3. 收款码 =====
    const badQq = await call('POST', '/api/qqbot/pay/receive-code', { bot: true, body: { qq: 'abc' } });
    check('QQ 号非法 → 400', badQq.status === 400, badQq.json?.error);

    const unbound = await call('POST', '/api/qqbot/pay/receive-code', { bot: true, body: { qq: QQ_UNBOUND } });
    check('未绑定 QQ → 404 且提示绑定', unbound.status === 404 && /未绑定|#绑定/.test(unbound.json?.error || ''), unbound.json?.error);

    const rc = await call('POST', '/api/qqbot/pay/receive-code', { bot: true, body: { qq: QQ_USER, amount: 12.5, note: '联调收款' } });
    check('收款码 200', rc.status === 200 && rc.json?.ok === true, JSON.stringify(rc.json).slice(0, 90));
    check('返回完整支付链接 + 二维码图片地址', /^https:\/\/xuanjian\.top\/pay\/[A-Za-z0-9_-]{16,}$/.test(rc.json?.url || '') && /\/api\/pay\/qr\.png\?text=/.test(rc.json?.qrUrl || ''), rc.json?.url);
    check('金额与备注透出、90 秒有效期', rc.json?.amount === 12.5 && rc.json?.note === '联调收款' && rc.json?.ttlSeconds === 90);
    check('收款主体为绑定用户', rc.json?.payee?.name === 'payqq_user' && rc.json?.user?.id === normalUser.id);

    const qrFetch = await call('GET', localize(rc.json.qrUrl));
    check('机器人拿到的 qrUrl 可被官网直接渲染为图片', qrFetch.status === 200 && qrFetch.ct.includes('image/png'), `${qrFetch.buf?.length} bytes`);

    const rcBadAmount = await call('POST', '/api/qqbot/pay/receive-code', { bot: true, body: { qq: QQ_USER, amount: 9999 } });
    check('超单笔上限（9999 > 500）→ 400', rcBadAmount.status === 400, rcBadAmount.json?.error);

    // ===== 4. 付款码 =====
    const pc = await call('POST', '/api/qqbot/pay/payer-code', { bot: true, body: { qq: QQ_USER } });
    check('付款码 200 且 60 秒有效', pc.status === 200 && pc.json?.ttlSeconds === 60 && pc.json?.kind === 'payer_code', `remain=${pc.json?.remainSeconds}s`);
    check('付款码返回可扫码完整链接', /^https:\/\/xuanjian\.top\/pay\//.test(pc.json?.url || ''));
    const pcQr = await call('GET', localize(pc.json.qrUrl));
    check('付款码 qrUrl 可渲染', pcQr.status === 200 && pcQr.ct.includes('image/png'));

    // ===== 5. 记录 =====
    const rec = await call('GET', `/api/qqbot/pay/records?qq=${QQ_USER}&limit=5`);
    check('记录查询 200（只读）', rec.status === 200 && Array.isArray(rec.json?.records), `todayPaid=${rec.json?.todayPaid}`);
    const recUnbound = await call('GET', `/api/qqbot/pay/records?qq=${QQ_UNBOUND}`);
    check('未绑定 QQ 查记录 → 404 提示', recUnbound.status === 404 && /未绑定/.test(recUnbound.json?.error || ''));

    // ===== 6. 缴费单权限 =====
    const chargeDenied = await call('POST', '/api/qqbot/pay/charge', { bot: true, body: { qq: QQ_USER, title: '联调团建费', amount: 10 } });
    check('普通成员开单 → 403（与网页同一套校验）', chargeDenied.status === 403, chargeDenied.json?.error);

    const charge = await call('POST', '/api/qqbot/pay/charge', {
        bot: true,
        body: { qq: QQ_ADMIN, title: '联调团建费', amount: 20, targets: [{ qq: QQ_USER }, { qq: QQ_UNBOUND, playerName: '未绑定某人' }] }
    });
    check('管理员开单 200', charge.status === 200 && charge.json?.ok === true, JSON.stringify(charge.json).slice(0, 100));
    check('名单按 QQ 解析：2 人（含 1 个未绑定）', charge.json?.targetCount === 2 && charge.json?.unmatchedQq?.length === 1, `unmatched=${JSON.stringify(charge.json?.unmatchedQq)}`);
    check('缴费单链接与二维码可用', /^https:\/\/xuanjian\.top\/pay\/charge\//.test(charge.json?.url || '') && /qr\.png/.test(charge.json?.qrUrl || ''));
    const chargeQr = await call('GET', localize(charge.json.qrUrl));
    check('缴费单 qrUrl 可渲染', chargeQr.status === 200 && chargeQr.ct.includes('image/png'));

    const chargeDetail = await call('GET', `/api/pay/charge/${charge.json.token}`, { jwtUser: adminUser });
    const rows = chargeDetail.json?.charge?.rows || chargeDetail.json?.rows || [];
    check('缴费单详情可读（复用 pay.js 数据）', chargeDetail.status === 200 && rows.length === 2, `rows=${rows.length}`);

    // ===== 7. 回归：重构后的网页接口 =====
    const webRc = await call('POST', '/api/pay/receive-code', { jwtUser: normalUser, body: { amount: 8, note: '网页回归' } });
    check('回归：网页收款码 200', webRc.status === 200 && webRc.json?.amount === 8, webRc.json?.error);
    const webPc = await call('GET', '/api/pay/payer-code/current', { jwtUser: normalUser });
    check('回归：网页付款码 200（60 秒）', webPc.status === 200 && webPc.json?.ttlSeconds === 60, `remain=${webPc.json?.remainSeconds}s`);
    const webRec = await call('GET', '/api/pay/records', { jwtUser: normalUser });
    check('回归：网页记录 200', webRec.status === 200 && Array.isArray(webRec.json?.records));
    const webCharge = await call('POST', '/api/pay/charge', { jwtUser: adminUser, body: { title: '网页回归缴费单', amount: 5 } });
    check('回归：网页开单 200', webCharge.status === 200 && webCharge.json?.ok === true, webCharge.json?.error);
    const webChargeDenied = await call('POST', '/api/pay/charge', { jwtUser: normalUser, body: { title: '越权', amount: 5 } });
    check('回归：网页普通成员开单 403', webChargeDenied.status === 403, webChargeDenied.json?.error);

    // ===== 清理 =====
    const ph = tmpIds.map(() => '?').join(',');
    await run(`DELETE FROM pay_charges WHERE intent_id IN (SELECT id FROM pay_intents WHERE created_by IN (${ph}))`, tmpIds);
    await run(`DELETE FROM pay_transactions WHERE from_user_id IN (${ph})`, tmpIds);
    await run(`DELETE FROM pay_intents WHERE created_by IN (${ph})`, tmpIds);
    await run(`DELETE FROM pay_payees WHERE user_id IN (${ph}) OR owner_user_id IN (${ph})`, [...tmpIds, ...tmpIds]);
    await run(`DELETE FROM contribution_logs WHERE user_id IN (${ph})`, tmpIds);
    await run(`DELETE FROM notifications WHERE user_id IN (${ph})`, tmpIds);
    await run(`DELETE FROM users WHERE id IN (${ph})`, tmpIds);
    const leftover = await get("SELECT COUNT(*) AS c FROM users WHERE username LIKE 'payqq_%'");
    const payeeLeft = await get('SELECT COUNT(*) AS c FROM pay_payees WHERE display_name LIKE ?', ['payqq_%']);
    console.log(`\n  清理完成：残留测试账号 ${leftover.c} 个，残留测试收款主体 ${payeeLeft.c} 个`);
    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===\n`);
    db.close();
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('联调脚本异常:', e); db.close(); process.exit(1); });
