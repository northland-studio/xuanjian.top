/**
 * 换服折算端到端测试（临时库）
 * 覆盖：候选列表与公户排除、统一比例、区间比例、二次确认（预览不改数据）、
 *       应用、应用时值变化拒绝、撤销、撤销保护、区间重叠校验。
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const TMP = path.join(os.tmpdir(), `conv-test-${Date.now()}.db`);
process.env.DB_FILE = TMP;
process.env.JWT_SECRET = 'conv-test-secret-0123456789abcdef';
const ROOT = path.resolve(__dirname, '..', '..');
const run = (s) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', s)], { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });

let pass = 0, fail = 0;
const ok = (n, c, extra = '') => {
    if (c) { pass++; console.log('  PASS ' + n); }
    else { fail++; console.log('  FAIL ' + n + (extra ? ' | ' + extra : '')); }
};

(async () => {
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
    run('migrate-wiki.js');
    const db = require(path.join(ROOT, 'database'));
    await db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nickname TEXT, email TEXT, password TEXT, level INTEGER DEFAULT 0, contribution REAL DEFAULT 0, avatar TEXT, game_id TEXT, generation TEXT, is_frozen INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.run(`CREATE TABLE IF NOT EXISTS contribution_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount REAL NOT NULL, type TEXT NOT NULL, ref_id INTEGER DEFAULT 0, note TEXT, balance_after REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate-contribution-conversion.js')], { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });

    // 造数据：10 个成员 + 公户 + 系统账号 + 冻结账号
    await db.run("INSERT INTO users (id, username, nickname, level, contribution) VALUES (1, 'a1', '甲', 0, 1000)");
    await db.run("INSERT INTO users (id, username, nickname, level, contribution) VALUES (2, 'a2', '乙', 0, 500)");
    await db.run("INSERT INTO users (id, username, nickname, level, contribution) VALUES (3, 'a3', '丙', 0, 300)");
    await db.run("INSERT INTO users (id, username, nickname, level, contribution) VALUES (4, 'a4', '丁', 0, 120)");
    await db.run("INSERT INTO users (id, username, nickname, level, contribution) VALUES (5, 'a5', '戊', 0, 60)");
    await db.run("INSERT INTO users (id, username, nickname, level, contribution, is_frozen) VALUES (6, 'a6', '冻结', 0, 50, 1)");
    await db.run("INSERT INTO users (id, username, nickname, level, contribution) VALUES (90, 'market_escrow', '集市托管账户', -1, 31.98)");
    await db.run("INSERT INTO users (id, username, nickname, level, contribution) VALUES (91, 'sys', '系统', -1, 0)");

    const conv = require(path.join(ROOT, 'lib', 'contribution-conversion'));

    console.log('\n--- 1. 候选名单与公户排除 ---');
    const cands = await conv.listCandidates({ scope: 'positive' });
    const escrow = cands.find((u) => u.username === 'market_escrow');
    ok('集市托管账户不在候选名单中（SQL 层排除）', !escrow, escrow ? JSON.stringify(escrow) : '');
    ok('系统账号(level<0)不在候选名单中', !cands.find((u) => u.username === 'sys'));
    ok('排名按贡献点降序', cands[0].username === 'a1' && cands[1].username === 'a2', cands.slice(0, 3).map((u) => u.username).join(','));
    ok('候选数（>0）为 6 人', cands.filter((u) => !u.excluded).length === 6, String(cands.filter((u) => !u.excluded).length));

    console.log('\n--- 2. 统一比例预览（不应改数据）---');
    const plan1 = await conv.buildPlan({ mode: 'uniform', uniformRatio: 0.5, scope: 'positive' });
    ok('参与人数正确', plan1.affected === 6, String(plan1.affected));
    ok('折算后总额为一半', Math.abs(plan1.totalAfter - plan1.totalBefore / 2) < 0.01, `${plan1.totalBefore}→${plan1.totalAfter}`);
    ok('甲乙丙丁戊各减半', ['甲', '乙', '丙', '丁', '戊'].every((n) => {
        const it = plan1.items.find((i) => i.nickname === n);
        return it && Math.abs(it.afterValue - Math.round(it.beforeValue * 0.5)) < 0.001;
    }));
    const u1Before = (await db.get('SELECT contribution FROM users WHERE id=1')).contribution;
    const convId = await conv.createPreview(plan1, { operatorId: 1, note: '测试统一比例' });
    const u1AfterPreview = (await db.get('SELECT contribution FROM users WHERE id=1')).contribution;
    ok('生成预览后用户数据未变', u1Before === u1AfterPreview, `${u1Before} vs ${u1AfterPreview}`);
    const convRow = await db.get('SELECT status FROM contribution_conversions WHERE id=?', [convId]);
    ok('批次状态为 preview', convRow.status === 'preview', convRow.status);

    console.log('\n--- 3. 应用折算 ---');
    await conv.applyConversion(convId, 1);
    const u1 = await db.get('SELECT contribution FROM users WHERE id=1');
    const u2 = await db.get('SELECT contribution FROM users WHERE id=2');
    ok('甲 1000 → 500', Number(u1.contribution) === 500, String(u1.contribution));
    ok('乙 500 → 250', Number(u2.contribution) === 250, String(u2.contribution));
    const escrowAfter = await db.get('SELECT contribution FROM users WHERE id=90');
    ok('托管账户未被改动', Number(escrowAfter.contribution) === 31.98, String(escrowAfter.contribution));
    const logs = await db.all("SELECT * FROM contribution_logs WHERE type='admin' AND ref_id=?", [convId]);
    ok('每个参与者一条流水', logs.length === 6, String(logs.length));
    ok('流水金额为负', logs.every((l) => l.amount < 0), JSON.stringify(logs.map((l) => l.amount)));

    console.log('\n--- 4. 重复应用被拒绝 ---');
    let dupErr = null;
    try { await conv.applyConversion(convId, 1); } catch (e) { dupErr = e; }
    ok('同一批不能重复应用', dupErr && dupErr.status === 409, dupErr && dupErr.message);

    console.log('\n--- 5. 区间折算 ---');
    const plan2 = await conv.buildPlan({
        mode: 'tiers',
        tiers: [{ from: 1, to: 3, ratio: 1.2 }, { from: 4, to: 10, ratio: 0.8 }],
        scope: 'positive'
    });
    ok('区间折算参与人数为 6', plan2.affected === 6, String(plan2.affected));
    const top = plan2.items.find((i) => i.nickname === '甲');
    ok('甲（排名1）×1.2 = 600', top && top.afterValue === 600, top && String(top.afterValue));
    const low = plan2.items.find((i) => i.nickname === '戊');
    // 此时戊的当前值已是统一比例后的 30，×0.8 = 24
    ok('戊（排名5）×0.8 = 24（基于当前值 30）', low && low.afterValue === 24, low && String(low.afterValue));

    console.log('\n--- 6. 区间校验 ---');
    let overlapErr = null;
    try {
        await conv.buildPlan({ mode: 'tiers', tiers: [{ from: 1, to: 5, ratio: 1 }, { from: 3, to: 8, ratio: 2 }] });
    } catch (e) { overlapErr = e; }
    ok('区间重叠被拒绝', overlapErr && overlapErr.status === 400, overlapErr && overlapErr.message);
    let ratioErr = null;
    try { await conv.buildPlan({ mode: 'uniform', uniformRatio: 99 }); } catch (e) { ratioErr = e; }
    ok('比例越界被拒绝', ratioErr && ratioErr.status === 400, ratioErr && ratioErr.message);

    console.log('\n--- 7. 应用时值变化被拒绝 ---');
    const conv2 = await conv.createPreview(
        await conv.buildPlan({ mode: 'uniform', uniformRatio: 0.5, scope: 'positive' }),
        { operatorId: 1 }
    );
    await db.run('UPDATE users SET contribution = 999 WHERE id = 1');
    let conflictErr = null;
    try { await conv.applyConversion(conv2, 1); } catch (e) { conflictErr = e; }
    ok('预览后值变化 → 拒绝应用', conflictErr && conflictErr.status === 409, conflictErr && conflictErr.message);

    console.log('\n--- 8. 撤销 ---');
    await db.run('UPDATE users SET contribution = 500 WHERE id = 1'); // 恢复一致
    // 先撤销旧的 conv2（未应用）
    await db.run("UPDATE contribution_conversions SET status='preview' WHERE id=?", [conv2]);
    await conv.applyConversion(conv2, 1);
    const beforeRevert = await db.get('SELECT contribution FROM users WHERE id=1');
    const conv2Detail = await conv.getConversion(conv2);
    const expected = Number(conv2Detail.items.find((i) => i.user_id === 1).before_value);
    await conv.revertConversion(conv2, 1);
    const afterRevert = await db.get('SELECT contribution FROM users WHERE id=1');
    ok('撤销后恢复到该批次折算前的值', Number(afterRevert.contribution) === expected, `${beforeRevert.contribution}→${afterRevert.contribution}（期望 ${expected}）`);
    const revStatus = await db.get('SELECT status FROM contribution_conversions WHERE id=?', [conv2]);
    ok('批次状态为 reverted', revStatus.status === 'reverted', revStatus.status);

    console.log('\n--- 9. 撤销保护（有更新批次时拒绝撤销旧批次）---');
    const conv3 = await conv.createPreview(await conv.buildPlan({ mode: 'uniform', uniformRatio: 0.9, scope: 'positive' }), { operatorId: 1 });
    await conv.applyConversion(conv3, 1);
    let oldRevertErr = null;
    try { await conv.revertConversion(convId, 1); } catch (e) { oldRevertErr = e; }
    ok('旧批次撤销被拒绝', oldRevertErr && oldRevertErr.status === 409, oldRevertErr && oldRevertErr.message);

    console.log('\n--- 10. 批次列表 ---');
    const list = await conv.listConversions(10);
    ok('批次列表可读', Array.isArray(list) && list.length >= 3, String(list.length));
    ok('含状态字段', list.every((c) => ['preview', 'applied', 'reverted'].includes(c.status)));

    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
    try { db.close(); } catch {}
    try { fs.rmSync(TMP, { force: true }); } catch {}
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error('异常：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
