// 迁移：任务人数配置
// 1) tasks 表加 max_people（-1 无限，>=1 限量）
// 2) player_tasks 表加 max_people（-1 无限，>=1 限量，默认 1）
// 3) 新建 player_task_claims 表（玩家任务多人接取记录）
// 幂等：可重复执行。
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));

(async () => {
    try {
        await db.run('PRAGMA busy_timeout = 10000');

        // ---- 1) tasks 加 max_people ----
        const tCols = await db.all('PRAGMA table_info(tasks)');
        const tNames = new Set(tCols.map(c => c.name));
        if (!tNames.has('max_people')) {
            await db.run('ALTER TABLE tasks ADD COLUMN max_people INTEGER DEFAULT -1');
            console.log('[tasks] 新增列 max_people');
        } else {
            console.log('[tasks] max_people 已存在，跳过');
        }

        // ---- 2) player_tasks 加 max_people ----
        const ptCols = await db.all('PRAGMA table_info(player_tasks)');
        const ptNames = new Set(ptCols.map(c => c.name));
        if (!ptNames.has('max_people')) {
            await db.run('ALTER TABLE player_tasks ADD COLUMN max_people INTEGER DEFAULT 1');
            console.log('[player_tasks] 新增列 max_people');
        } else {
            console.log('[player_tasks] max_people 已存在，跳过');
        }

        // ---- 3) player_task_claims 表 ----
        await db.run(`CREATE TABLE IF NOT EXISTS player_task_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
            code TEXT,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES player_tasks(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(task_id, user_id)
        )`);
        await db.run('CREATE INDEX IF NOT EXISTS idx_ptc_task ON player_task_claims(task_id)');
        console.log('[player_task_claims] 表已就绪');

        // 将已存在玩家任务迁移到 claims（若有已接取者）
        const accepted = await db.all("SELECT * FROM player_tasks WHERE status = 'accepted' AND acceptor_id IS NOT NULL");
        for (const a of accepted) {
            const exists = await db.get('SELECT id FROM player_task_claims WHERE task_id = ? AND user_id = ?', [a.id, a.acceptor_id]);
            if (!exists) {
                await db.run('INSERT INTO player_task_claims (task_id, user_id, status, created_at) VALUES (?, ?, ?, ?)', [a.id, a.acceptor_id, 'pending', a.updated_at]);
                console.log(`[player_task_claims] 迁移接取记录: task=${a.id} user=${a.acceptor_id}`);
            }
        }

        const t = await db.get('SELECT COUNT(*) AS c FROM tasks');
        const pt = await db.get('SELECT COUNT(*) AS c FROM player_tasks');
        console.log(`[完成] tasks ${t.c} 条，player_tasks ${pt.c} 条`);
        db.close();
        process.exit(0);
    } catch (e) {
        console.error('[失败] 迁移:', e.message);
        process.exit(1);
    }
})();
