// 迁移：contribution_logs 表 type CHECK 约束补充 'title' 类型
// 背景：购买称号会扣减贡献点，但原白名单无 'title'，导致 addContributionLog 抛 SQLITE_CONSTRAINT
// 用法：先备份数据库，再执行 node scripts/migrate-add-title-type.js
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));

(async () => {
    try {
        // 幂等：若已包含 title 则跳过
        const cur = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='contribution_logs'`);
        if (cur?.sql?.includes("'title'")) {
            console.log('[跳过] contribution_logs 已包含 title 类型');
            return;
        }

        await db.run('ALTER TABLE contribution_logs RENAME TO contribution_logs_old');
        await db.run(`CREATE TABLE contribution_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('claim', 'task', 'transfer_in', 'transfer_out', 'purchase', 'reward', 'admin', 'player_task', 'transfer', 'title')),
            ref_id INTEGER DEFAULT 0,
            note TEXT,
            balance_after INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        await db.run(`INSERT INTO contribution_logs (id, user_id, amount, type, ref_id, note, balance_after, created_at)
            SELECT id, user_id, amount, type, ref_id, note, balance_after, created_at FROM contribution_logs_old`);
        await db.run('DROP TABLE contribution_logs_old');
        await db.run('CREATE INDEX IF NOT EXISTS idx_contribution_logs_user ON contribution_logs(user_id, created_at)');
        const n = await db.get('SELECT COUNT(*) AS c FROM contribution_logs');
        console.log(`[完成] contribution_logs 表 CHECK 约束已扩展（新增 title），现有 ${n.c} 条记录`);
    } catch (e) {
        console.error('[失败] 重建 contribution_logs:', e.message);
        process.exit(1);
    } finally {
        db.close();
    }
})();
