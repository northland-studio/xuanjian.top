/**
 * 出图与群内审批接口联调（本地/生产通用）
 * 用法：node scripts/test-pay-render.js [port|baseUrl] [--prod]
 *   本地：node scripts/test-pay-render.js 3999        （需本地服务已启动）
 *   生产：node scripts/test-pay-render.js https://xuanjian.top --prod --token=<botToken>
 * 生产模式只做只读检查（渲染公开海报、签名链接、待审批列表），不会创建/审批任何数据。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const path = require('path');
const crypto = require('crypto');

const arg = process.argv[2] || '3999';
const PROD = process.argv.includes('--prod');
const BASE = arg.startsWith('http') ? arg.replace(/\/+$/, '') : `http://127.0.0.1:${arg}`;
const tokenArg = (process.argv.find(a => a.startsWith('--token=')) || '').slice(8);

const db = PROD ? null : new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guild.db'));
const get = (sql, a = []) => new Promise((r, j) => db.get(sql, a, (e, x) => e ? j(e) : r(x)));
const run = (sql, a = []) => new Promise((r, j) => db.run(sql, a, function (e) { e ? j(e) : r(this); }));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' · ' + extra : ''}`); }
    else { fail++; console.log(`  ✗ ${name}${extra ? ' · ' + extra : ''}`); }
};
const tok = (userId, level = 0) => jwt.sign({ userId, level }, process.env.JWT_SECRET);
const api = async (method, url, { userId = 0, level = 0, botToken = '', body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (userId) headers.Authorization = 'Bearer ' + tok(userId, level);
    if (botToken) headers['X-Bot-Token'] = botToken;
    const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    let json = null, buf = null;
    if (ct.includes('json')) { try { json = await res.json(); } catch (_) { } }
    else { buf = Buffer.from(await res.arrayBuffer()); }
    return { status: res.status, json, buf, ct };
};

(async () => {
    console.log(`\n=== 出图 / 群内审批 联调 @ ${BASE}${PROD ? '（生产只读模式）' : ''} ===\n`);
    const botToken = tokenArg || process.env.QQBOT_TOKEN || '';
    check('读到了机器人 token', !!botToken, botToken ? `长度 ${botToken.length}` : '缺失（--token= 或 .env QQBOT_TOKEN）');

    let chargeToken = null, createdIntent = null, qq = null, qqUser = null, adminId = null;
    let adminQqBefore = null, adminRow = null, marks = null, adminBalBefore = 0;

    if (!PROD) {
        marks = {};
        for (const t of ['pay_transactions', 'pay_intents', 'pay_charges', 'pay_payees', 'contribution_logs', 'notifications']) {
            marks[t] = (await get(`SELECT COALESCE(MAX(id),0) AS m FROM ${t}`)).m;
        }
        adminRow = await get("SELECT id, level, qq, COALESCE(contribution,0) AS contribution FROM users WHERE level >= 1 AND username <> 'guild_treasury' ORDER BY level DESC LIMIT 1");
        adminId = adminRow.id;
        adminQqBefore = adminRow.qq || null;
        adminBalBefore = adminRow.contribution;

        // 清理历史遗留的测试绑定，避免 users.qq 唯一约束冲突
        await run("UPDATE users SET qq = NULL WHERE qq IN ('13900000001','13900000002') AND username <> 'payrender_t'");

        // 付款人：专用测试账号（余额 500，绑定 13900000001）
        let payer = await get("SELECT id, nickname, qq FROM users WHERE username = 'payrender_t'");
        if (!payer) {
            const r = await run("INSERT INTO users (username,nickname,password,level,contribution,qq,created_at) VALUES ('payrender_t','出图验收付款人','!paytest!',0,500,'13900000001',datetime('now','localtime'))");
            payer = { id: r.lastID, nickname: '出图验收付款人', qq: '13900000001' };
        } else {
            await run("UPDATE users SET contribution = 500, qq = '13900000001' WHERE id = ?", [payer.id]);
        }
        // 审批人：把现有管理员临时绑定到 13900000002
        await run("UPDATE users SET qq = '13900000002' WHERE id = ?", [adminId]);
        qqUser = payer;
        qq = payer.qq;

        const rc = await api('POST', '/api/pay/charge', { userId: adminId, level: 5, body: { title: '出图验收缴费单', amount: 5, targets: [{ userId: adminId }] } });
        check('创建缴费单（本地）', rc.status === 200 && !!rc.json?.token);
        chargeToken = rc.json?.token;
        createdIntent = rc.json?.token;
    }

    // 1) 公开缴费单海报
    if (chargeToken) {
        const poster = await api('GET', `/api/pay/render/charge/${chargeToken}.png`);
        check('缴费单海报 200/PNG', poster.status === 200 && poster.ct.includes('image/png') && poster.buf?.length > 3000,
            `bytes=${poster.buf?.length}`);
        check('PNG 魔数正确', poster.buf && poster.buf.slice(0, 4).toString('hex') === '89504e47');
        const q = await api('GET', `/api/pay/render/charge.png?token=${chargeToken}`);
        check('query 形式同样可用', q.status === 200 && q.ct.includes('image/png'), `bytes=${q.buf?.length}`);
        const miss = await api('GET', '/api/pay/render/charge/not-a-real-token-000000.png');
        check('不存在的缴费单 404', miss.status === 404);
    } else {
        console.log('  – 生产只读模式：跳过缴费单海报（需 token，跳过）');
    }

    // 2) 对账海报：必须签名
    const noSig = await api('GET', '/api/pay/render/summary.png');
    check('对账海报无签名被拒 403', noSig.status === 403, noSig.json?.error);
    if (botToken) {
        const signed = await api('GET', '/api/qqbot/pay/render-url?kind=summary', { botToken });
        check('换取签名链接 200', signed.status === 200 && /render\/summary\.png\?exp=\d+&sig=[0-9a-f]{32}$/.test(signed.json?.url || ''),
            signed.json?.url);
        if (signed.json?.url) {
            const pathOnly = signed.json.url.replace(/^https?:\/\/[^/]+/, '');
            const img = await api('GET', pathOnly);
            check('签名链接可取图 200/PNG', img.status === 200 && img.ct.includes('image/png') && img.buf?.length > 2000, `bytes=${img.buf?.length}`);
            const tampered = await api('GET', pathOnly.replace(/sig=[0-9a-f]{32}/, 'sig=' + 'f'.repeat(32)));
            check('篡改签名被拒 403', tampered.status === 403);
            const expired = await api('GET', pathOnly.replace(/exp=\d+/, 'exp=' + (Math.floor(Date.now() / 1000) - 10)));
            check('过期签名被拒 403', expired.status === 403);
        }
        const kind = await api('GET', '/api/qqbot/pay/render-url?kind=nope', { botToken });
        check('不支持的图片类型 400', kind.status === 400);
        check('无 token 换签名链接 401', (await api('GET', '/api/qqbot/pay/render-url?kind=summary')).status === 401);
    }

    // 3) 待审批列表 + 群内审批（本地造一笔大额后走完整链路）
    if (botToken) {
        const pend = await api('GET', '/api/qqbot/pay/pending-approvals', { botToken });
        check('待审批列表 200', pend.status === 200 && Array.isArray(pend.json?.approvals), `当前 ${pend.json?.approvals?.length} 笔`);
        check('返回风控阈值', typeof pend.json?.thresholds?.single === 'number', JSON.stringify(pend.json?.thresholds));
    }
    if (!PROD && botToken && chargeToken) {
        // 付款人（13900000001）造一笔 300 点大额 → 进待审批
        const rc = await api('POST', '/api/pay/receive-code', { userId: adminId, level: 5, body: { amount: 300, note: '出图验收大额' } });
        const confirm = await api('POST', `/api/pay/intents/${rc.json.token}/confirm`, { userId: qqUser.id, body: {} });
        check('造出待审批大额', confirm.json?.status === 'pending_approval', confirm.json?.message || confirm.json?.error);
        const txId = confirm.json?.transactionId;
        const list = await api('GET', '/api/qqbot/pay/pending-approvals', { botToken });
        check('待审批列表含该笔', !!txId && list.json?.approvals?.some(a => a.id === txId));

        const unbound = await api('POST', `/api/qqbot/pay/approve/${txId}`, { botToken, body: { qq: '13900000009', action: 'approve' } });
        check('未绑定 QQ 审批 404', unbound.status === 404, unbound.json?.error?.slice(0, 30));
        const nonAdmin = await api('POST', `/api/qqbot/pay/approve/${txId}`, { botToken, body: { qq, action: 'approve' } });
        check('非管理员 QQ 审批 403', nonAdmin.status === 403, nonAdmin.json?.error);
        const approve = await api('POST', `/api/qqbot/pay/approve/${txId}`, { botToken, body: { qq: '13900000002', action: 'approve' } });
        check('管理员群内审批通过', approve.json?.ok && approve.json?.status === 'success', approve.json?.message || approve.json?.error);
        const again = await api('POST', `/api/qqbot/pay/approve/${txId}`, { botToken, body: { qq: '13900000002', action: 'approve' } });
        check('重复审批 409', again.status === 409, again.json?.error);
        check('不存在的流水 404', (await api('POST', '/api/qqbot/pay/approve/99999999', { botToken, body: { qq: '13900000002', action: 'reject' } })).status === 404);
    }

    /* ---------------- 清理（仅本地） ---------------- */
    if (!PROD && marks) {
        const payerBal = await get("SELECT id, contribution FROM users WHERE username = 'payrender_t'");
        if (adminRow) await run('UPDATE users SET contribution = ? WHERE id = ?', [adminBalBefore, adminId]);
        await run('DELETE FROM pay_transactions WHERE id > ?', [marks.pay_transactions]);
        await run('DELETE FROM pay_charges WHERE id > ?', [marks.pay_charges]);
        await run('DELETE FROM pay_intents WHERE id > ?', [marks.pay_intents]);
        await run('DELETE FROM pay_payees WHERE id > ?', [marks.pay_payees]);
        await run('DELETE FROM contribution_logs WHERE id > ?', [marks.contribution_logs]);
        await run('DELETE FROM notifications WHERE id > ?', [marks.notifications]);
        if (payerBal) await run('DELETE FROM users WHERE id = ?', [payerBal.id]);
        if (adminRow) await run('UPDATE users SET qq = ? WHERE id = ?', [adminQqBefore, adminId]);
        console.log(`  清理完成：测试账号已删除，管理员 QQ 还原，流水/意图/名单/通知已清`);
    }

    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===\n`);
    if (db) db.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('联调异常:', e); if (db) db.close(); process.exit(1); });
