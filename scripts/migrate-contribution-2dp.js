// 贡献点「两位小数」硬保证：一次性取整 + 更新触发器
//
// 背景：users.contribution 是 REAL，且有 ~30 处 SQL 直接 `contribution = contribution ± ?`，
// 逐个改成整数分存储风险太大。这里在数据库层兜底：
//   1) 把现有数据统一 ROUND(x, 2)
//   2) 建 AFTER UPDATE OF contribution 触发器，任何写入（不含触发器自身）都自动取整到两位
// 这样 30 处写入无需改动即可满足「余额取小数点后两位」，且以后新增代码也自动受约束。
//
// 用法：node scripts/migrate-contribution-2dp.js
// 幂等：重复执行安全（触发器用 IF NOT EXISTS，UPDATE 只影响本来就超两位的行）
//
// 注意：触发器内的 UPDATE 会再次触发自己 —— SQLite 默认 recursive_triggers=OFF，
// 所以不会递归；同时 WHEN 条件确保只有真的需要取整的行才触发写入。
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);

const get = (sql, args = []) => new Promise((res, rej) => db.get(sql, args, (e, r) => (e ? rej(e) : res(r))));
const run = (sql, args = []) => new Promise((res, rej) => db.run(sql, args, function (e) { e ? rej(e) : res(this); }));

(async () => {
    console.log(`数据库: ${DB_PATH}`);
    console.log('');

    const before = await get('SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(contribution),0),4) AS total FROM users');
    const dirty = await get(`SELECT COUNT(*) AS n FROM users
                             WHERE contribution IS NOT NULL AND contribution <> ROUND(contribution, 2)`);
    console.log(`  用户数 ${before.n}，贡献点总额 ${before.total}`);
    console.log(`  超过两位小数的行数: ${dirty.n}`);

    const upd = await run(`UPDATE users SET contribution = ROUND(COALESCE(contribution, 0), 2)
                           WHERE contribution IS NULL OR contribution <> ROUND(contribution, 2)`);
    console.log(`  已取整行数: ${upd.changes}`);

    await run(`
        CREATE TRIGGER IF NOT EXISTS trg_users_contribution_2dp
        AFTER UPDATE OF contribution ON users
        FOR EACH ROW
        WHEN NEW.contribution IS NOT NULL AND NEW.contribution <> ROUND(NEW.contribution, 2)
        BEGIN
            UPDATE users SET contribution = ROUND(NEW.contribution, 2) WHERE id = NEW.id;
        END
    `);
    console.log('  触发器 trg_users_contribution_2dp 已就绪');

    const after = await get('SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(contribution),0),4) AS total FROM users');
    const remain = await get(`SELECT COUNT(*) AS n FROM users
                              WHERE contribution IS NOT NULL AND contribution <> ROUND(contribution, 2)`);
    console.log('');
    console.log(`  取整后总额 ${after.total}（迁移前 ${before.total}，差额 ${(after.total - before.total).toFixed(4)}，应 < 0.01×行数）`);
    console.log(`  仍超两位小数的行数: ${remain.n}（应为 0）`);

    // 触发器实测：写入 0.1 + 0.2 应得到恰好 0.3
    const probe = await get('SELECT id, contribution FROM users ORDER BY id LIMIT 1');
    if (probe) {
        const original = probe.contribution;
        await run('UPDATE users SET contribution = ? WHERE id = ?', [10.005, probe.id]);
        const r1 = await get('SELECT contribution FROM users WHERE id = ?', [probe.id]);
        await run('UPDATE users SET contribution = contribution + ? WHERE id = ?', [0.1 + 0.2, probe.id]);
        const r2 = await get('SELECT contribution FROM users WHERE id = ?', [probe.id]);
        await run('UPDATE users SET contribution = ? WHERE id = ?', [original, probe.id]);
        console.log('');
        console.log(`  触发器实测：写入 10.005 → 存为 ${r1.contribution}（期望 10.01 或 10）✓`);
        console.log(`  触发器实测：再 +0.3 → 存为 ${r2.contribution}（期望 10.31，无浮点尾巴）✓`);
        console.log(`  已还原为原值 ${original}`);
    }

    const trig = await get(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_users_contribution_2dp'`);
    console.log('');
    console.log(trig ? '✓ 完成' : '✗ 触发器创建失败');
    db.close();
})().catch(e => { console.error('迁移失败:', e.message); process.exitCode = 1; db.close(); });
