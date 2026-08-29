// 迁移：QQ 群机器人绑定功能
// 1) users 表补 qq 列（可空；一个 QQ 号唯一绑定一个账号）
// 2) 新建 qq_bindings 表（一次性绑定码，待确认/已确认）
// 幂等：可重复执行。用法：先备份数据库，再执行 node scripts/migrate-qq-bind.js
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));

(async () => {
    try {
        await db.run('PRAGMA busy_timeout = 10000');

        // ---- 1) users 补 qq 列 ----
        const userCols = await db.all('PRAGMA table_info(users)');
        const colNames = new Set(userCols.map(c => c.name));
        if (!colNames.has('qq')) {
            // SQLite 不支持 ADD COLUMN UNIQUE，先加普通列再用唯一索引
            await db.run('ALTER TABLE users ADD COLUMN qq TEXT');
            console.log('[users] 新增列 qq');
        } else {
            console.log('[users] qq 已存在，跳过');
        }
        // 唯一索引（若 qq 非空且去重后无冲突才建）
        try {
            await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_qq ON users(qq) WHERE qq IS NOT NULL AND qq != ''`);
            console.log('[users] qq 唯一索引已就绪');
        } catch (e) {
            console.log('[users] qq 唯一索引跳过（存在重复值需先清理）:', e.message);
        }

        // ---- 2) qq_bindings 表 ----
        await db.run(`CREATE TABLE IF NOT EXISTS qq_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            qq TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','expired')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            confirmed_at DATETIME,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        await db.run('CREATE INDEX IF NOT EXISTS idx_qq_bindings_qq ON qq_bindings(qq, status)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_qq_bindings_code ON qq_bindings(code)');
        console.log('[qq_bindings] 表已就绪');

        const u = await db.get('SELECT COUNT(*) AS c FROM users');
        const b = await db.get('SELECT COUNT(*) AS c FROM qq_bindings');
        console.log(`[完成] 迁移成功，users ${u.c} 条，qq_bindings ${b.c} 条`);
        db.close();
        process.exit(0);
    } catch (e) {
        console.error('[失败] 迁移:', e.message);
        process.exit(1);
    }
})();
