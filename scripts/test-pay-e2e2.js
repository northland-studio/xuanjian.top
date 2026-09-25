/**
 * 贡献点扫码支付 阶段 3-5 联调：付款码反扫 / 缴费单 / 审批 / 对账
 * 用法：先启动本地服务（PORT=3999），再 node scripts/test-pay-e2e2.js 3999
 * 生产用法：PAY_TEST_USERS=<付款人id>,<收款人id> node scripts/test-pay-e2e2.js 3000
 * 说明：会临时改动余额（结算后清理阶段全部回滚），并删除本次产生的流水/意图/名单/通知。
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
const tok = (userId, level = 0) => jwt.sign({ userId, level }, process.env.JWT_SECRET);
const api = async (method, url, userId, body, level = 0) => {
    const res = await fetch(BASE + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: 'Bearer ' + tok(userId, level) } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const ct = res.headers.get('content-type') || '';
    let json = null, text = null;
    if (ct.includes('json')) { try { json = await res.json(); } catch (_) { } }
    else { try { text = await res.text(); } catch (_) { } }
    return { status: res.status, json, text, ct };
};
const bal = async (id) => (await get('SELECT ROUND(COALESCE(contribution,0),2) AS c FROM users WHERE id = ?', [id])).c;

(async () => {
    console.log(`\n=== 扫码支付 阶段 3-5 联调 @ ${BASE} ===\n`);

    const vault = await get("SELECT id, contribution FROM users WHERE username = 'guild_treasury'");
    const ids = (process.env.PAY_TEST_USERS || '').split(',').map(s => parseInt(s.trim())).filter(Boolean);
    const users = ids.length >= 2
        ? await all(`SELECT id, username, nickname, level, COALESCE(contribution,0) AS contribution FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids)
        : await all(`SELECT id, username, nickname, level, COALESCE(contribution,0) AS contribution FROM users
                     WHERE username <> 'guild_treasury' ORDER BY contribution DESC LIMIT 2`);
    const [payer, payee] = users;
    const admin = await get(`SELECT id, username, nickname FROM users WHERE level >= 1 AND username <> 'guild_treasury' ORDER BY level DESC LIMIT 1`);
    if (!payer || !payee || !admin) throw new Error('缺少可用用户（需要 2 个普通用户 + 1 个管理员）');
    const outsider = await get(
        `SELECT id, nickname, username FROM users
         WHERE id NOT IN (?, ?) AND username <> 'guild_treasury'
           AND COALESCE(level, 0) = 0 AND COALESCE(email_verified, 0) = 0
         ORDER BY id LIMIT 1`, [payer.id, payee.id]);
    console.log(`付款人 #${payer.id} ${payer.nickname} | 收款人 #${payee.id} ${payee.nickname} | 管理员 #${admin.id} ${admin.nickname} | 名单外 #${outsider?.id} ${outsider?.nickname}\n`);

    const before = { payer: await bal(payer.id), payee: await bal(payee.id), vault: await bal(vault.id) };
    // 阈值快照：用例期间用默认阈值（500/2000/200），结束后原样恢复
    const SETTING_KEYS = ['pay_single_limit', 'pay_daily_limit', 'pay_approval_threshold'];
    const phKeys = SETTING_KEYS.map(() => '?').join(',');
    const settingsBefore = await all(`SELECT key, value FROM settings WHERE key IN (${phKeys})`, SETTING_KEYS);
    await run(`DELETE FROM settings WHERE key IN (${phKeys})`, SETTING_KEYS);
    const marks = {};
    for (const t of ['pay_transactions', 'pay_intents', 'pay_charges', 'pay_payees', 'contribution_logs', 'notifications']) {
        marks[t] = (await get(`SELECT COALESCE(MAX(id),0) AS m FROM ${t}`)).m;
    }

    /* ================= A. 付款码（反扫） ================= */
    console.log('A. 付款码反扫闭环');
    // 付款人余额补足到 600 以便覆盖大额审批用例（清理阶段回滚）
    await run('UPDATE users SET contribution = 600 WHERE id = ?', [payer.id]);
    const basePayer = 600.0;

    const code1 = await api('GET', '/api/pay/payer-code/current', payer.id);
    check('获取付款码 200', code1.status === 200 && code1.json?.kind === 'payer_code', `剩余 ${code1.json?.remainSeconds}s`);
    check('付款码 60 秒有效期', code1.json?.ttlSeconds === 60 && code1.json?.remainSeconds <= 60);
    const reused = await api('GET', '/api/pay/payer-code/current', payer.id);
    check('重复获取复用同一付款码', reused.json?.token === code1.json?.token);
    check('未登录获取付款码 401', (await fetch(BASE + '/api/pay/payer-code/current')).status === 401);

    const selfScan = await api('POST', '/api/pay/scan', payer.id, { code: code1.json.token, amount: 5 });
    check('扫自己的付款码被拒', selfScan.status === 400, selfScan.json?.error);

    const scan = await api('POST', '/api/pay/scan', payee.id, { code: `https://xuanjian.top/pay/${code1.json.token}`, amount: 7, note: '反扫联调' });
    check('收款方扫码发起收款 200', scan.status === 200 && scan.json?.mode === 'payer_code', scan.json?.message);
    const childToken = scan.json?.token;
    const scanDup = await api('POST', '/api/pay/scan', payee.id, { code: code1.json.token, amount: 8 });
    check('同一付款码二次扫描被拒 409', scanDup.status === 409, scanDup.json?.error);

    const pend = await api('GET', '/api/pay/payer-code/pending', payer.id);
    check('付款人轮询到待确认付款', pend.json?.pending?.token === childToken && pend.json?.pending?.amount === 7,
        `${pend.json?.pending?.payeeName} 请求 ${pend.json?.pending?.amount} 点`);
    check('待确认包含用途备注', pend.json?.pending?.note === '反扫联调');
    const pendOther = await api('GET', '/api/pay/payer-code/pending', payee.id);
    check('他人看不到该待确认付款', pendOther.json?.pending === null);

    const payChild = await api('POST', `/api/pay/intents/${childToken}/confirm`, payer.id, {});
    check('付款人确认反扫收款 200', payChild.status === 200 && payChild.json?.status === 'success', payChild.json?.message);
    check('反扫扣款正确', await bal(payer.id) === Number((basePayer - 7).toFixed(2)), `600 → ${await bal(payer.id)}`);
    check('反扫入账正确', await bal(payee.id) === Number((before.payee + 7).toFixed(2)), `${before.payee} → ${await bal(payee.id)}`);
    const pendAfter = await api('GET', '/api/pay/payer-code/pending', payer.id);
    check('确认后不再显示待确认', pendAfter.json?.pending === null);

    // 直扫收款码（扫码方即付款人）
    const rc2 = await api('POST', '/api/pay/receive-code', payee.id, { amount: 3, note: '直扫' });
    const direct = await api('POST', '/api/pay/scan', payer.id, { code: rc2.json.token });
    check('扫收款码返回 direct 模式', direct.json?.mode === 'direct' && direct.json?.token === rc2.json.token, direct.json?.message);
    const locked = await api('GET', `/api/pay/intents/${rc2.json.token}`, outsider.id);
    const outsiderPay = await api('POST', `/api/pay/intents/${rc2.json.token}/confirm`, outsider.id, {});
    check('他人抢付被占用拦截 409', outsiderPay.status === 409, outsiderPay.json?.error);
    const directPay = await api('POST', `/api/pay/intents/${rc2.json.token}/confirm`, payer.id, {});
    check('扫码方确认支付成功', directPay.status === 200 && directPay.json?.status === 'success', directPay.json?.message);
    const rejectAfterPaid = await api('POST', `/api/pay/intents/${rc2.json.token}/reject`, payer.id, {});
    check('已支付不可取消 409', rejectAfterPaid.status === 409, rejectAfterPaid.json?.error);

    /* ================= B. 缴费单（一码多人） ================= */
    console.log('\nB. 缴费单码');
    const charge = await api('POST', '/api/pay/charge', admin.id, {
        title: '联调团建费', amount: 6, note: 'B 用例',
        targets: [{ userId: payer.id }, { userId: payee.id }, { playerName: '未绑定玩家甲', amount: 4 }]
    }, 5);
    check('创建缴费单 200', charge.status === 200 && !!charge.json?.token, `名单 ${charge.json?.targetCount} 人 · ${charge.json?.message}`);
    check('缴费单未定金额校验（无金额无名单）', (await api('POST', '/api/pay/charge', admin.id, { title: 'x' }, 5)).status === 400);
    check('非管理员非认证成员无法开单', (await api('POST', '/api/pay/charge', outsider.id, { title: 'x', amount: 1 })).status === 403);
    const chargeToken = charge.json.token;

    const detail = await api('GET', `/api/pay/charge/${chargeToken}`, payer.id);
    check('缴费单详情 200', detail.status === 200 && detail.json?.stats?.count === 3, `共 ${detail.json?.stats?.count} 人 / 应缴 ${detail.json?.stats?.total}`);
    check('我的份额正确', detail.json?.mine?.amount === 6 && detail.json?.mine?.status === 'unpaid');
    check('名单含未绑定玩家', detail.json?.roster?.some(r => r.name === '未绑定玩家甲' && r.amount === 4));

    const payCharge = await api('POST', `/api/pay/charge/${chargeToken}/pay`, payer.id, {});
    check('缴费成功 200', payCharge.status === 200 && payCharge.json?.status === 'success', payCharge.json?.message);
    const detail2 = await api('GET', `/api/pay/charge/${chargeToken}`, payer.id);
    check('名单状态同步为已缴', detail2.json?.mine?.status === 'paid' && detail2.json?.stats?.paidCount === 1, `已缴 ${detail2.json?.stats?.paidSum}/${detail2.json?.stats?.total}`);
    check('重复缴费拦截 409', (await api('POST', `/api/pay/charge/${chargeToken}/pay`, payer.id, {})).status === 409);
    check('名单外成员缴费 403', (await api('POST', `/api/pay/charge/${chargeToken}/pay`, outsider.id, {})).status === 403);
    check('缴费单列表包含我参与的', (await api('GET', '/api/pay/charges', payer.id)).json?.charges?.some(c => c.token === chargeToken));

    // 开放缴纳（谁都能缴）+ 收款方为系统金库
    const openCharge = await api('POST', '/api/pay/charge', admin.id, { title: '联调公会金库', amount: 4, openAll: true, payeeType: 'system', note: '金库用例' }, 5);
    const vaultBefore = await bal(vault.id);
    const openPay = await api('POST', `/api/pay/charge/${openCharge.json.token}/pay`, payee.id, {});
    check('开放缴费单任何人可缴', openPay.status === 200 && openPay.json?.status === 'success', openPay.json?.message);
    check('款项进入系统金库「玄剑财政」', await bal(vault.id) === Number((vaultBefore + 4).toFixed(2)), `${vaultBefore} → ${await bal(vault.id)}`);
    const closeCharge = await api('POST', `/api/pay/charge/${openCharge.json.token}/close`, admin.id, {}, 5);
    check('创建者可关闭缴费单', closeCharge.status === 200 && closeCharge.json?.status === 'closed');
    check('关闭后不可缴费 409', (await api('POST', `/api/pay/charge/${openCharge.json.token}/pay`, payer.id, {})).status === 409);
    check('他人无法关闭缴费单', (await api('POST', `/api/pay/charge/${chargeToken}/close`, outsider.id, {})).status === 403);

    /* ================= B2. 名单管理：搜索成员 / 逐个加入 / 移出 ================= */
    console.log('\nB2. 缴费单名单管理（官网搜索成员逐个加入）');
    const rosterCharge = await api('POST', '/api/pay/charge', admin.id, { title: '联调名单管理', amount: 3, targets: [{ userId: payer.id }] }, 5);
    const rc2Token = rosterCharge.json.token;

    const search = await api('GET', `/api/pay/members?q=${encodeURIComponent(payee.nickname || payee.username)}`, admin.id, null, 5);
    check('搜索成员 200', search.status === 200 && Array.isArray(search.json?.members), `命中 ${search.json?.members?.length} 人`);
    check('搜索结果含目标成员且不泄露 QQ 号', search.json?.members?.some(m => m.id === payee.id && !('qq' in m)),
        JSON.stringify(search.json?.members?.[0] || {}).slice(0, 110));
    check('空关键词返回空列表', (await api('GET', '/api/pay/members?q=', admin.id, null, 5)).json?.members?.length === 0);
    check('无开单权限者搜索 403', (await api('GET', `/api/pay/members?q=${encodeURIComponent(payer.nickname)}`, outsider.id)).status === 403);

    const addOne = await api('POST', `/api/pay/charge/${rc2Token}/targets`, admin.id, { targets: [{ userId: payee.id }] }, 5);
    check('逐个加入成员 200', addOne.status === 200 && addOne.json?.added === 1, addOne.json?.message);
    check('重复加入被拒（已在名单）', (await api('POST', `/api/pay/charge/${rc2Token}/targets`, admin.id, { targets: [{ userId: payee.id }] }, 5)).status === 400);
    const addGuest = await api('POST', `/api/pay/charge/${rc2Token}/targets`, admin.id, { targets: [{ playerName: '未绑定玩家乙' }] }, 5);
    check('按名称加入未绑定玩家 200', addGuest.status === 200 && addGuest.json?.added === 1);
    const addByQq = await api('POST', `/api/pay/charge/${rc2Token}/targets`, admin.id, { targets: [{ qq: '10000099' }] }, 5);
    check('按 QQ 加入未绑定者记入名单', addByQq.status === 200 && addByQq.json?.unmatchedQq?.length === 1, JSON.stringify(addByQq.json?.unmatchedQq || []));

    const rc2Detail = await api('GET', `/api/pay/charge/${rc2Token}`, payer.id);
    check('名单统计更新为 4 人', rc2Detail.json?.stats?.count === 4, `共 ${rc2Detail.json?.stats?.count} 人`);
    const addedRow = rc2Detail.json?.roster?.find(r => r.userId === payee.id);
    check('名单含被加入的成员', !!addedRow && addedRow.status === 'unpaid');
    check('被加入者收到待缴通知', (await all(`SELECT title FROM notifications WHERE user_id = ? AND id > ? AND type='pay'`, [payee.id, marks.notifications])).some(n => /待缴/.test(n.title)));
    check('搜索接口标记已在名单', (await api('GET', `/api/pay/members?q=${encodeURIComponent(payee.nickname || payee.username)}&exclude=${rc2Token}`, admin.id, null, 5)).json?.members?.find(m => m.id === payee.id)?.inRoster === true);

    check('非创建者非管理员加入成员 403', (await api('POST', `/api/pay/charge/${rc2Token}/targets`, outsider.id, { targets: [{ userId: outsider.id }] })).status === 403);
    const removeRow = await api('DELETE', `/api/pay/charge/${rc2Token}/targets/${addedRow.id}`, admin.id, null, 5);
    check('移出未缴成员 200', removeRow.status === 200 && removeRow.json?.ok, removeRow.json?.message);
    const afterRemove = await api('GET', `/api/pay/charge/${rc2Token}`, payer.id);
    check('移出后名单为 3 人', afterRemove.json?.stats?.count === 3, `共 ${afterRemove.json?.stats?.count} 人`);
    check('移出不存在/已移出的行 404', (await api('DELETE', `/api/pay/charge/${rc2Token}/targets/${addedRow.id}`, admin.id, null, 5)).status === 404);
    // 关闭后不可再加人
    await api('POST', `/api/pay/charge/${rc2Token}/close`, admin.id, {}, 5);
    check('已关闭缴费单不可加人 409', (await api('POST', `/api/pay/charge/${rc2Token}/targets`, admin.id, { targets: [{ userId: outsider.id }] }, 5)).status === 409);

    /* ================= C. 大额审批 ================= */
    console.log('\nC. 大额审批');
    const bigRc = await api('POST', '/api/pay/receive-code', payee.id, { amount: 300, note: '大额审批用例' });
    const preBig = await bal(payer.id);
    const bigPay = await api('POST', `/api/pay/intents/${bigRc.json.token}/confirm`, payer.id, {});
    check('大额进入待审批', bigPay.json?.status === 'pending_approval', bigPay.json?.message);
    const bigTxId = bigPay.json?.transactionId;
    check('审批中不扣款', await bal(payer.id) === preBig, `${preBig} → ${await bal(payer.id)}`);
    const approvals = await api('GET', '/api/pay/admin/approvals', admin.id, null, 5);
    check('管理员待审批列表含该笔', approvals.json?.approvals?.some(a => a.id === bigTxId && a.amount === 300));
    check('非管理员看审批列表 403', (await api('GET', '/api/pay/admin/approvals', outsider.id)).status === 403);
    const preApprove = await bal(payer.id);
    const approve = await api('POST', `/api/pay/admin/approve/${bigTxId}`, admin.id, { action: 'approve' }, 5);
    check('审批通过并完成划转', approve.status === 200 && approve.json?.status === 'success', approve.json?.message);
    check('通过后扣款正确', await bal(payer.id) === Number((preApprove - 300).toFixed(2)), `${preApprove} → ${await bal(payer.id)}`);
    check('通过后不可重复审批 409', (await api('POST', `/api/pay/admin/approve/${bigTxId}`, admin.id, { action: 'approve' }, 5)).status === 409);

    const rejRc = await api('POST', '/api/pay/receive-code', payee.id, { amount: 250, note: '驳回用例' });
    const rejPay = await api('POST', `/api/pay/intents/${rejRc.json.token}/confirm`, payer.id, {});
    const rejTxId = rejPay.json?.transactionId;
    const preReject = await bal(payer.id);
    const reject = await api('POST', `/api/pay/admin/approve/${rejTxId}`, admin.id, { action: 'reject' }, 5);
    check('审批驳回 200', reject.status === 200 && reject.json?.status === 'rejected', reject.json?.message);
    check('驳回不动余额', await bal(payer.id) === preReject, `${preReject}`);
    const rejIntent = await get('SELECT status FROM pay_intents WHERE token = ?', [rejRc.json.token]);
    check('驳回后意图置 rejected', rejIntent?.status === 'rejected');
    const payerNotif = await all(`SELECT title, type FROM notifications WHERE user_id = ? AND id > ? AND type='pay'`, [payer.id, marks.notifications]);
    check('付款人收到审批结果通知', payerNotif.some(n => /驳回/.test(n.title)) && payerNotif.some(n => /通过/.test(n.title)), payerNotif.map(n => n.title).join(' / '));

    // 缴费单大额 → 审批通过后名单同步已缴
    const bigCharge = await api('POST', '/api/pay/charge', admin.id, { title: '联调大额缴费', amount: 220, targets: [{ userId: payer.id }] }, 5);
    const bigChargePay = await api('POST', `/api/pay/charge/${bigCharge.json.token}/pay`, payer.id, {});
    check('缴费单大额进入审批', bigChargePay.json?.status === 'pending_approval', bigChargePay.json?.message);
    const cd1 = await api('GET', `/api/pay/charge/${bigCharge.json.token}`, payer.id);
    check('名单显示待审批', cd1.json?.mine?.status === 'pending_approval');
    await api('POST', `/api/pay/admin/approve/${bigChargePay.json?.transactionId}`, admin.id, { action: 'approve' }, 5);
    const cd2 = await api('GET', `/api/pay/charge/${bigCharge.json.token}`, payer.id);
    check('审批通过后名单同步已缴', cd2.json?.mine?.status === 'paid' && cd2.json?.stats?.paidCount === 1);

    /* ================= D. 对账 ================= */
    console.log('\nD. 对账与流水');
    const summary = await api('GET', '/api/pay/admin/summary', admin.id, null, 5);
    check('对账概览 200', summary.status === 200 && summary.json?.total?.sum > 0, `累计 ${summary.json?.total?.sum} 点 / ${summary.json?.total?.count} 笔`);
    check('概览含金库余额', summary.json?.vault?.name === '玄剑财政', `余额 ${summary.json?.vault?.balance}`);
    check('概览含活跃码与 Top 收款方', typeof summary.json?.activeCodes === 'number' && summary.json?.topPayees?.length > 0);
    const recs = await api('GET', '/api/pay/admin/records?status=success&limit=5', admin.id, null, 5);
    check('全量流水筛选 200', recs.status === 200 && recs.json?.records?.length > 0, `success 共 ${recs.json?.total} 笔 / 成功金额 ${recs.json?.successSum}`);
    const csv = await api('GET', '/api/pay/admin/records?format=csv', admin.id, null, 5);
    check('CSV 导出可用', csv.status === 200 && csv.ct.includes('csv') && csv.text?.includes('流水号') && csv.text?.includes('收款方'), `长度 ${csv.text?.length}`);
    check('非管理员导出 403', (await api('GET', '/api/pay/admin/records?format=csv', outsider.id)).status === 403);
    const settingsPut = await api('PUT', '/api/pay/admin/settings', admin.id, { single: 500, daily: 2000, approval: 200 }, 5);
    check('阈值保存 200', settingsPut.status === 200 && settingsPut.json?.single === 500);
    check('非管理员改阈值 403', (await api('PUT', '/api/pay/admin/settings', outsider.id, { single: 1 })).status === 403);
    const myRecs = await api('GET', '/api/pay/records', payer.id);
    check('我的记录含本次支出与今日额度', myRecs.json?.records?.length > 0 && myRecs.json?.todayPaid > 0, `今日已付 ${myRecs.json?.todayPaid}`);

    /* ================= 清理 ================= */
    await run('UPDATE users SET contribution = ? WHERE id = ?', [before.payer, payer.id]);
    await run('UPDATE users SET contribution = ? WHERE id = ?', [before.payee, payee.id]);
    await run('UPDATE users SET contribution = ? WHERE id = ?', [before.vault, vault.id]);
    await run('DELETE FROM pay_transactions WHERE id > ?', [marks.pay_transactions]);
    await run('DELETE FROM pay_charges WHERE id > ?', [marks.pay_charges]);
    await run('DELETE FROM pay_intents WHERE id > ?', [marks.pay_intents]);
    await run('DELETE FROM pay_payees WHERE id > ?', [marks.pay_payees]);
    await run('DELETE FROM contribution_logs WHERE id > ?', [marks.contribution_logs]);
    await run('DELETE FROM notifications WHERE id > ?', [marks.notifications]);
    await run(`DELETE FROM settings WHERE key IN (${phKeys})`, SETTING_KEYS);
    for (const s of settingsBefore) await run('INSERT INTO settings (key, value) VALUES (?, ?)', [s.key, s.value]);
    console.log(`  阈值已恢复：${settingsBefore.length ? settingsBefore.map(s => s.key + '=' + s.value).join(' / ') : '（原本未设置，用默认 500/2000/200）'}`);
    console.log(`\n  清理完成：余额回滚 付款人=${await bal(payer.id)} 收款人=${await bal(payee.id)} 金库=${await bal(vault.id)}`);
    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===\n`);
    db.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('联调脚本异常:', e); db.close(); process.exit(1); });
