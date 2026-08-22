// 迁移：2026-08-22 六项功能更新涉及的数据库变更
// 1) users 表补 is_frozen / last_login_ip / last_login_at
// 2) 新建 login_attempts 表（异常登录检测）
// 3) 新建 guild_disciplinary_actions 表（GDARS 处分记录，支持撤销+解冻）
// 4) contribution_logs 表 type CHECK 白名单扩展 'discipline' / 'post'
// 幂等：可重复执行。用法：先备份数据库，再执行 node scripts/migrate-20260822.js
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));

(async () => {
    try {
        await db.run('PRAGMA busy_timeout = 10000');

        // ---- 1) users 补列（若不存在）----
        const userCols = await db.all('PRAGMA table_info(users)');
        const colNames = new Set(userCols.map(c => c.name));
        const addCols = [
            ['is_frozen', 'INTEGER DEFAULT 0'],
            ['last_login_ip', 'TEXT'],
            ['last_login_at', 'DATETIME']
        ];
        for (const [name, def] of addCols) {
            if (!colNames.has(name)) {
                await db.run(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
                console.log(`[users] 新增列 ${name}`);
            } else {
                console.log(`[users] ${name} 已存在，跳过`);
            }
        }

        // ---- 2) login_attempts 表 ----
        await db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            ip TEXT,
            user_agent TEXT,
            success INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await db.run('CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(user_id, created_at)');
        console.log('[login_attempts] 表已就绪');

        // ---- 3) guild_disciplinary_actions 表 ----
        await db.run(`CREATE TABLE IF NOT EXISTS guild_disciplinary_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            level INTEGER NOT NULL CHECK (level IN (1,2,3)),
            reason TEXT NOT NULL DEFAULT '',
            extra_penalty TEXT DEFAULT '',
            deduct_points INTEGER DEFAULT 0,
            admin_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            revoked_at DATETIME,
            revoked_by INTEGER,
            revoked_reason TEXT DEFAULT '',
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (admin_id) REFERENCES users(id)
        )`);
        await db.run('CREATE INDEX IF NOT EXISTS idx_gda_user ON guild_disciplinary_actions(user_id, created_at)');
        console.log('[guild_disciplinary_actions] 表已就绪');

        // ---- 4) contribution_logs type CHECK 扩展 ----
        const cur = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='contribution_logs'`);
        if (cur?.sql?.includes("'discipline'") && cur?.sql?.includes("'post'")) {
            console.log('[contribution_logs] 已包含 discipline / post，跳过重建');
        } else {
            const types = ['claim', 'task', 'transfer_in', 'transfer_out', 'purchase', 'reward', 'admin', 'player_task', 'transfer', 'title', 'discipline', 'post'];
            const checkStr = types.map(t => `'${t}'`).join(', ');
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
            const n = await db.get('SELECT COUNT(*) AS c FROM contribution_logs');
            console.log(`[contribution_logs] CHECK 约束已扩展（discipline/post），现有 ${n.c} 条记录`);
        }

        const u = await db.get('SELECT COUNT(*) AS c FROM users');
        console.log(`[完成] 迁移成功，users 现有 ${u.c} 条`);
        db.close();
        process.exit(0);
    } catch (e) {
        console.error('[失败] 迁移:', e.message);
        process.exit(1);
    }
})();
