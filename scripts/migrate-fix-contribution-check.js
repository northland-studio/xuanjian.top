// 迁移：修复 contribution_logs 表 type CHECK 约束，补充 player_task / transfer 类型
// 背景：玩家任务（player_task）与模组转账（transfer）调用的流水类型不在原 CHECK 白名单内，
//       导致 addContributionLog 抛 SQLITE_CONSTRAINT，玩家任务发布返回失败、流水缺失。
const db = require('../database');

(async () => {
    try {
        await db.run('PRAGMA busy_timeout = 10000');

        const types = ['claim', 'task', 'transfer_in', 'transfer_out', 'purchase', 'reward', 'admin', 'player_task', 'transfer'];
        const checkStr = types.map(t => `'${t}'`).join(', ');

        await db.run('BEGIN');
        try {
            await db.run('ALTER TABLE contribution_logs RENAME TO contribution_logs_old');

            await db.run(`CREATE TABLE contribution_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN (${checkStr})),
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
            await db.run('COMMIT');

            const n = await db.get('SELECT COUNT(*) AS c FROM contribution_logs');
            console.log(`[完成] contribution_logs 表 CHECK 约束已扩展（新增 player_task / transfer），现有 ${n.c} 条记录`);
        } catch (e) {
            await db.run('ROLLBACK');
            console.error('[失败] 重建 contribution_logs:', e.message);
            process.exit(1);
        }

        db.close();
        process.exit(0);
    } catch (e) {
        console.error('迁移失败:', e);
        process.exit(1);
    }
})();
