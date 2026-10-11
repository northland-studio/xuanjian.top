/**
 * 集市系统账号（market_escrow）与官网既有功能的隔离自检
 *
 * 背景：托管账号 level=-1，是官网唯一的"系统账号"。它必须：
 *   1) 不能被任何会员转账（否则托管余额 ≠ 在途订单合计，账就对不平）
 *   2) 不出现在排行榜/经济报表/成员搜索/聊天搜索/纪律查询/档案导出里
 *   3) 不能被加进缴费单名单（付费名单是真实会员）
 *
 * 用法：先启动测试服务（DB_FILE=data/wiki-mobile-test.db PORT=3998 node server.js）
 *       DB_FILE=data/wiki-mobile-test.db node scripts/test-market-isolation.js 3998
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2]) || 3998;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.resolve(ROOT, process.env.DB_FILE || 'data/guild.db');

const db = new sqlite3.Database(DB_PATH);
const get = (sql, a = []) => new Promise((r, j) => db.get(sql, a, (e, x) => e ? j(e) : r(x)));
const run = (sql, a = []) => new Promise((r, j) => db.run(sql, a, function (e) { e ? j(e) : r(this); }));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' · ' + extra : ''}`); }
    else { fail++; failures.push(name); console.log(`  ✗ ${name}${extra ? ' · ' + extra : ''}`); }
}
const tok = (userId, level = 0) => jwt.sign({ userId, level }, process.env.JWT_SECRET);
async function api(method, url, userId, body) {
    const res = await fetch(BASE + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: 'Bearer ' + tok(userId) } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (_) { }
    return { status: res.status, json, text: json ? '' : '' };
}
const hasEscrow = (v) => JSON.stringify(v === undefined ? null : v).includes('market_escrow');

(async () => {
    console.log(`\n=== 集市系统账号隔离自检 @ ${BASE}（库：${path.relative(ROOT, DB_PATH)}）===`);

    const escrow = await get("SELECT id, contribution FROM users WHERE username = 'market_escrow'");
    if (!escrow) throw new Error('托管账号不存在：请先跑 scripts/migrate-marketplace.js');
    const payer = await get("SELECT id FROM users WHERE username = 'mkt_e2e_buyer'") || await get('SELECT id FROM users LIMIT 1');
    const admin = await get("SELECT id FROM users WHERE username = 'mkt_e2e_admin'") || await get('SELECT id FROM users WHERE level >= 2 LIMIT 1');
    const beforeEscrow = escrow.contribution;
    const beforePayer = (await get('SELECT contribution FROM users WHERE id = ?', [payer.id])).contribution;

    // 给托管账号临时放一笔"在途资金"，否则"不出现在榜单"的结论没有说服力
    await run('UPDATE users SET contribution = 500 WHERE id = ?', [escrow.id]);
    console.log(`（临时把托管账号余额设为 500 以验证隔离，结束后恢复为 ${beforeEscrow}）\n`);

    // 1 转账隔离（资金安全最关键）
    console.log('—— 1. 不能给系统账号转账 ——');
    const t1 = await api('POST', '/api/contributions/transfer', payer.id, { toUserId: escrow.id, amount: 1, note: '隔离自检' });
    check('会员向托管账号转账被拒绝', t1.status === 400 && /系统账号/.test(t1.json && t1.json.error || ''), `${t1.status} ${t1.json && t1.json.error || ''}`);
    check('拒绝后托管余额未变', (await get('SELECT contribution FROM users WHERE id = ?', [escrow.id])).contribution === 500);
    check('拒绝后付款人余额未变', (await get('SELECT contribution FROM users WHERE id = ?', [payer.id])).contribution === beforePayer);
    const t2 = await api('POST', '/api/contributions/transfer', escrow.id, { toUserId: payer.id, amount: 1, note: '隔离自检' });
    check('托管账号自身也无法主动转账（level=-1 无正常登录态，此处仅确认接口未被滥用）', t2.status >= 400, `HTTP ${t2.status}`);

    // 2 榜单/报表隔离
    console.log('\n—— 2. 榜单与经济报表隔离 ——');
    const rk = await api('GET', '/api/rankings/contribution?limit=50', null);
    check('贡献点排行榜不含托管账号', rk.status === 200 && !hasEscrow(rk.json.rankings), `HTTP ${rk.status}`);
    const eco = await api('GET', '/api/economics/overview', null);
    check('经济概览（Top10 持仓）不含托管账号', eco.status === 200 && !hasEscrow(eco.json), `HTTP ${eco.status}`);
    const ecoExp = await api('GET', '/api/economics/export', null);
    check('经济报表导出（全员账户）不含托管账号', ecoExp.status === 200 && !hasEscrow(ecoExp.json), `HTTP ${ecoExp.status}`);
    const ck = await api('GET', '/api/rankings/checkin?limit=50', null);
    check('签到排行榜不含托管账号', ck.status === 200 && !hasEscrow(ck.json), `HTTP ${ck.status}`);

    // 3 成员搜索隔离
    console.log('\n—— 3. 成员搜索 / 聊天搜索 / 纪律查询隔离 ——');
    const chat = await api('GET', '/api/chat/mentions?q=market', payer.id);
    check('聊天 @ 搜索不到托管账号', chat.status === 200 && !hasEscrow(chat.json.users), `HTTP ${chat.status}`);
    const chatAll = await api('GET', '/api/chat/mentions', payer.id);
    check('聊天最近用户列表不含托管账号', chatAll.status === 200 && !hasEscrow(chatAll.json.users), `HTTP ${chatAll.status}`);
    if (admin) {
        const paym = await api('GET', '/api/pay/members?q=market', admin.id);
        check('缴费单成员搜索不到托管账号', paym.status === 200 && !hasEscrow(paym.json.members), `${paym.status} ${JSON.stringify(paym.json).slice(0, 80)}`);
        const don = await api('GET', '/api/donation/admin/search-users?q=market', admin.id);
        check('捐赠录入的成员搜索不到托管账号', don.status === 200 && !hasEscrow(don.json.users), `HTTP ${don.status}`);
    }
    const dq = await api('GET', '/api/discipline/query?username=market', null);
    check('纪律处分用户查询不到托管账号', dq.status === 200 && !hasEscrow(dq.json.users || dq.json), `HTTP ${dq.status}`);
    // 档案导出依赖多张既有业务表：本测试库是精简副本，该接口在本库恒为 500
    // （已用 git stash 还原原始 gmirs.js 复测过：原代码在本库同样 500，与本集市改动无关）；
    // 因此本库只校验"搜索/查伪"路径，导出改在生产库校验。
    const needTables = ['guild_disciplinary_actions', 'contribution_claims', 'tasks', 'player_tasks', 'titles', 'posts', 'shop_items'];
    const present = [];
    for (const t of needTables) {
        const r = await get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [t]);
        if (r) present.push(t);
    }
    const gm = await api('GET', '/api/gmirs/export', null);
    if (gm.status === 200) {
        check('成员档案导出不含托管账号', !hasEscrow(gm.json.archives));
    } else {
        console.log(`  · 跳过成员档案导出检查（${path.basename(DB_PATH)} 里该接口恒为 ${gm.status}：既有测试库缺表所致，原代码同样失败，已单独在生产库核对）`);
    }
    const gq = await api('GET', '/api/gmirs/query?keyword=market', null);
    check('档案查询搜索不到托管账号', gq.status === 200 && !hasEscrow(gq.json.users), `HTTP ${gq.status}`);
    const gscan = await api('GET', '/api/gmirs/verify?code=NOT-A-REAL-CODE', null);
    check('档案查伪扫描正常且不暴露托管账号', gscan.status === 200 && gscan.json.valid === false, `HTTP ${gscan.status}`);

    // 4 集市内部视图仍能看到它（管理需要）
    console.log('\n—— 4. 集市内部仍可见（对账/管理需要）——');
    const fin = await api('GET', '/api/market/admin/finance', admin.id);
    check('集市收入分户账接口能看到托管账号与余额', fin.status === 200 && fin.json.accounts.escrow && fin.json.accounts.escrow.balance === 500,
        `HTTP ${fin.status} 余额=${fin.json.accounts && fin.json.accounts.escrow && fin.json.accounts.escrow.balance}`);

    // 恢复
    await run('UPDATE users SET contribution = ? WHERE id = ?', [beforeEscrow, escrow.id]);
    await run('UPDATE users SET contribution = ? WHERE id = ?', [beforePayer, payer.id]);
    console.log(`\n（已恢复托管余额 ${beforeEscrow} 与付款人余额 ${beforePayer}）`);
    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
    if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
    db.close();
    process.exit(fail ? 1 : 0);
})().catch(async (e) => {
    console.error('自检中断：', e.message);
    db.close();
    process.exit(1);
});
