/**
 * 贡献点扫码支付：本地端到端联调（收款码主扫闭环）
 * 用法：先启动本地服务（PORT=3999），再 node scripts/test-pay-e2e.js 3999
 *
 * 覆盖：生成收款码 → 扫码读取 → 本人确认支付 → 重复支付拦截 → 大额转审批 →
 *       余额/流水/通知落库校验 → 记录查询；结束后回滚余额并清理测试数据
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const path = require('path');

const PORT = process.argv[2] || 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guild.db'));
const get = (sql, a = []) => new Promise((r, j) => db.get(sql, a, (e, x) => e ? j(e) : r(x)));
const all = (sql, a = []) => new Promise((r, j) => db.all(sql, a, (e, x) => e ? j(e) : r(x)));
const run = (sql, a = []) => new Promise((r, j) => db.run(sql, a, function (e) { e ? j(e) : r(this); }));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' · ' + extra : ''}`); }
    else { fail++; console.log(`  ✗ ${name}${extra ? ' · ' + extra : ''}`); }
}
const api = async (method, url, userId, body) => {
    const res = await fetch(BASE + url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(userId ? { Authorization: 'Bearer ' + jwt.sign({ userId, level: 0 }, process.env.JWT_SECRET) } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch (_) { }
    return { status: res.status, json };
};

(async () => {
    console.log(`\n=== 贡献点扫码支付 本地联调 @ ${BASE} ===\n`);

    const vault = await get("SELECT id, contribution FROM users WHERE username = 'guild_treasury'");
    // 允许用专用测试账号（生产联调时避免动真实用户余额）
    const ids = (process.env.PAY_TEST_USERS || '').split(',').map(s => parseInt(s.trim())).filter(Boolean);
    const users = ids.length === 2
        ? await all(`SELECT id, username, nickname, COALESCE(contribution,0) AS contribution FROM users WHERE id IN (?, ?) ORDER BY id`, ids)
        : await all(
            `SELECT id, username, nickname, COALESCE(contribution,0) AS contribution FROM users
             WHERE username <> 'guild_treasury' ORDER BY contribution DESC LIMIT 2`);
    if (users.length < 2) throw new Error('本地库缺少可用用户');
    const [payer, payee] = users;
    console.log(`付款人: #${payer.id} ${payer.nickname} (${payer.contribution} 点) | 收款人: #${payee.id} ${payee.nickname} (${payee.contribution} 点) | 金库 #${vault.id}\n`);

    const before = { payer: payer.contribution, payee: payee.contribution, vault: vault.contribution };
    const startTxId = (await get('SELECT COALESCE(MAX(id),0) AS m FROM pay_transactions')).m;
    const startLogId = (await get('SELECT COALESCE(MAX(id),0) AS m FROM contribution_logs')).m;
    const startNotifId = (await get('SELECT COALESCE(MAX(id),0) AS m FROM notifications')).m;

    // 1. 生成收款码（收款人出示）
    const rc = await api('POST', '/api/pay/receive-code', payee.id, { amount: 5, note: '联调收款' });
    check('生成收款码 200', rc.status === 200, JSON.stringify(rc.json).slice(0, 120));
    const token = rc.json?.token;
    check('返回 128bit token + 90s 有效期', !!token && token.length >= 22 && rc.json.ttlSeconds === 90, `token=${token?.slice(0, 8)}… ttl=${rc.json?.ttlSeconds}`);
    check('收款主体为收款人本人', rc.json?.payee?.name === (payee.nickname || payee.username), rc.json?.payee?.name);

    // 2. 扫码读取付款信息
    const view = await api('GET', `/api/pay/intents/${token}`, payer.id);
    check('扫码读取付款信息 200', view.status === 200);
    check('金额/备注透出', view.json?.intent?.amount === 5 && view.json?.intent?.note === '联调收款');
    check('非本人（isSelf=false）', view.json?.isSelf === false);
    check('风控阈值透出 500/2000/200', view.json?.limits?.single === 500 && view.json?.limits?.daily === 2000 && view.json?.limits?.approval === 200);

    // 3. 必须登录才能读取（无 token → 401）
    const anon = await fetch(BASE + `/api/pay/intents/${token}`);
    check('未登录读取被拒 401', anon.status === 401, `status=${anon.status}`);

    // 4. 自己扫自己的码 → 拒绝
    if (payee.contribution >= 5) {
        const self = await api('POST', `/api/pay/intents/${token}/confirm`, payee.id, {});
        check('禁止自我付款 400', self.status === 400, self.json?.error);
    } else {
        console.log('  – 收款人余额不足 5 点，跳过自我付款用例');
    }

    // 5. 正常支付
    const pay = await api('POST', `/api/pay/intents/${token}/confirm`, payer.id, {});
    check('付款成功 200', pay.status === 200 && pay.json?.status === 'success', pay.json?.message || pay.json?.error);
    const txId = pay.json?.transactionId;
    const payerAfter = (await get('SELECT ROUND(COALESCE(contribution,0),2) AS c FROM users WHERE id = ?', [payer.id])).c;
    const payeeAfter = (await get('SELECT ROUND(COALESCE(contribution,0),2) AS c FROM users WHERE id = ?', [payee.id])).c;
    check('付款人余额 -5', payerAfter === Math.round((before.payer - 5) * 100) / 100, `${before.payer} → ${payerAfter}`);
    check('收款人余额 +5', payeeAfter === Math.round((before.payee + 5) * 100) / 100, `${before.payee} → ${payeeAfter}`);
    check('响应返回最新余额', pay.json?.balance === payerAfter, `balance=${pay.json?.balance}`);

    const tx = await get('SELECT * FROM pay_transactions WHERE id = ?', [txId]);
    check('流水落库 status=success', tx?.status === 'success' && tx.amount === 5, `tx#${txId} ${tx?.amount} 点`);
    const intentRow = await get('SELECT status, paid_tx_id, payer_user_id FROM pay_intents WHERE token = ?', [token]);
    check('意图归位 paid + 关联流水', intentRow?.status === 'paid' && intentRow?.paid_tx_id === txId && intentRow?.payer_user_id === payer.id);

    // 6. 重复支付拦截
    const again = await api('POST', `/api/pay/intents/${token}/confirm`, payer.id, {});
    check('重复支付拦截 409', again.status === 409, again.json?.error);

    // 7. 流水日志 + 通知
    const logs = await all(`SELECT * FROM contribution_logs WHERE id > ? ORDER BY id`, [startLogId]);
    const outLog = logs.find(l => l.type === 'pay_out' && l.user_id === payer.id);
    const inLog = logs.find(l => l.type === 'pay_in' && l.user_id === payee.id);
    check('贡献点流水 pay_out / pay_in 各一条', !!outLog && !!inLog, `pay_out=${outLog?.amount} pay_in=${inLog?.amount}`);
    check('流水 balance_after 正确', outLog?.balance_after === payerAfter && inLog?.balance_after === payeeAfter);
    const notif = await all(`SELECT * FROM notifications WHERE id > ? AND type = 'pay'`, [startNotifId]);
    check('收款人收到站内通知 type=pay', notif.some(n => n.user_id === payee.id), notif[0] ? notif[0].title : '无');

    // 8. 大额（>200）转审批，不动余额
    const bigToken = (await api('POST', '/api/pay/receive-code', payee.id, { amount: 300 })).json?.token;
    // 付款人余额不足以支撑 300 时，临时补足以覆盖审批用例（清理阶段会回滚）
    if (payer.contribution - 5 < 300) {
        await run('UPDATE users SET contribution = 500 WHERE id = ?', [payer.id]);
        console.log(`  – 付款人余额不足 300，已临时补足至 500（用例结束后回滚）`);
    }
    const payerPreBig = (await get('SELECT ROUND(COALESCE(contribution,0),2) AS c FROM users WHERE id = ?', [payer.id])).c;
    const big = await api('POST', `/api/pay/intents/${bigToken}/confirm`, payer.id, {});
    check('大额转审批 200 pending_approval', big.status === 200 && big.json?.status === 'pending_approval', big.json?.message || big.json?.error);
    const payerBig = (await get('SELECT ROUND(COALESCE(contribution,0),2) AS c FROM users WHERE id = ?', [payer.id])).c;
    check('审批中不扣款', payerBig === payerPreBig, `${payerPreBig} → ${payerBig}`);
    const bigIntent = await get('SELECT status FROM pay_intents WHERE token = ?', [bigToken]);
    check('意图状态 awaiting_approval', bigIntent?.status === 'awaiting_approval');
    const bigTx = await get(`SELECT * FROM pay_transactions WHERE intent_id = (SELECT id FROM pay_intents WHERE token = ?)`, [bigToken]);
    check('审批流水 status=pending_approval', bigTx?.status === 'pending_approval' && bigTx?.amount === 300);
    const bigAgain = await api('POST', `/api/pay/intents/${bigToken}/confirm`, payer.id, {});
    check('审批中重复提交拦截 409', bigAgain.status === 409, bigAgain.json?.error);

    // 9. 过期二维码 → 410
    const expToken = (await api('POST', '/api/pay/receive-code', payee.id, { amount: 5 })).json?.token;
    await run(`UPDATE pay_intents SET expires_at = datetime('now','localtime','-1 minutes') WHERE token = ?`, [expToken]);
    const expired = await api('POST', `/api/pay/intents/${expToken}/confirm`, payer.id, {});
    check('过期二维码拦截 410', expired.status === 410, expired.json?.error);

    // 10. 单笔超限 / 金额非法
    const overToken = (await api('POST', '/api/pay/receive-code', payee.id, {})).json?.token;
    const over = await api('POST', `/api/pay/intents/${overToken}/confirm`, payer.id, { amount: 501 });
    check('单笔超 500 拦截 400', over.status === 400, over.json?.error);
    const badAmount = await api('POST', `/api/pay/intents/${overToken}/confirm`, payer.id, { amount: 0.001 });
    check('金额非正/超精度拦截', badAmount.status === 400, badAmount.json?.error);

    // 11. 日累计上限（临时把单日上限调成 10 验证风控）
    await run(`INSERT INTO settings (key, value) VALUES ('pay_daily_limit', '10')
               ON CONFLICT(key) DO UPDATE SET value = '10'`);
    const recBeforeDaily = await api('GET', '/api/pay/records?limit=1', payer.id);
    const paidToday = recBeforeDaily.json?.todayPaid;
    const d1 = await api('POST', `/api/pay/intents/${(await api('POST', '/api/pay/receive-code', payee.id, { amount: 5 })).json?.token}/confirm`, payer.id, {});
    const d2 = await api('POST', `/api/pay/intents/${(await api('POST', '/api/pay/receive-code', payee.id, { amount: 5 })).json?.token}/confirm`, payer.id, {});
    check('日累计上限生效（第二笔被拒）', d2.status === 400 && /额度不足/.test(d2.json?.error || ''), `已付今日 ${paidToday} → ${d1.json?.status} / ${d2.json?.error}`);
    await run(`DELETE FROM settings WHERE key = 'pay_daily_limit'`);

    // 12. 记录查询
    const rec = await api('GET', '/api/pay/records?limit=5', payer.id);
    check('我的记录可查 200', rec.status === 200 && Array.isArray(rec.json?.records), `共 ${rec.json?.records?.length} 条`);
    check('记录含本次支出', rec.json?.records?.some(r => r.id === txId && r.direction === 'out' && r.amount === 5));

    // 13. 阈值权限
    const noAdmin = await api('PUT', '/api/pay/admin/settings', payer.id, { single: 600 });
    check('非管理员改阈值 403', noAdmin.status === 403);

    // ===== 清理：回滚余额、删除测试数据 =====
    await run('UPDATE users SET contribution = ? WHERE id = ?', [before.payer, payer.id]);
    await run('UPDATE users SET contribution = ? WHERE id = ?', [before.payee, payee.id]);
    await run('DELETE FROM pay_transactions WHERE id > ?', [startTxId]);
    await run('DELETE FROM pay_intents WHERE created_at >= datetime(\'now\',\'localtime\',\'-10 minutes\')');
    await run('DELETE FROM contribution_logs WHERE id > ?', [startLogId]);
    await run('DELETE FROM notifications WHERE id > ?', [startNotifId]);
    const restored = { payer: (await get('SELECT contribution FROM users WHERE id=?', [payer.id])).contribution, payee: (await get('SELECT contribution FROM users WHERE id=?', [payee.id])).contribution };
    console.log(`\n  清理完成：余额已回滚 ${restored.payer} / ${restored.payee}，测试流水与通知已删除`);
    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===\n`);
    db.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('联调脚本异常:', e); db.close(); process.exit(1); });
