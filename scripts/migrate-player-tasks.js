// 迁移：创建玩家任务表 player_tasks（玩家发布悬赏任务，消耗贡献点，验证码核实后转账）
const db = require('../database');

(async () => {
    try {
        const exists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='player_tasks'");
        if (exists) {
            console.log('player_tasks 表已存在，跳过');
        } else {
            await db.run(`
                CREATE TABLE player_tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    author_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    images TEXT DEFAULT '',
                    reward INTEGER NOT NULL,
                    code TEXT NOT NULL,
                    status TEXT DEFAULT 'open',
                    acceptor_id INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('player_tasks 表创建成功');
        }
        db.close();
        process.exit(0);
    } catch (e) {
        console.error('迁移失败:', e);
        process.exit(1);
    }
})();
