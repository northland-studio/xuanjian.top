// 迁移：投影仓库表 + 任务/发帖支持投影文件字段
const db = require('../database');

(async () => {
    try {
        // 1. 投影仓库表
        const exists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='projections'");
        if (exists) {
            console.log('projections 表已存在，跳过');
        } else {
            await db.run(`
                CREATE TABLE projections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    file_url TEXT NOT NULL,
                    file_size INTEGER DEFAULT 0,
                    tags TEXT DEFAULT '',
                    author_id INTEGER NOT NULL,
                    downloads INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (author_id) REFERENCES users(id)
                )
            `);
            console.log('projections 表创建成功');
        }

        // 2. 各表补充 projection 字段（列已存在时静默跳过；表名为内部常量，无注入风险）
        const columns = [
            ['tasks', 'projection'],
            ['player_tasks', 'projection'],
            ['posts', 'projection']
        ];
        for (const [table, column] of columns) {
            const cols = await db.all(
                `PRAGMA table_info(${table})`
            );
            if (cols.some(c => c.name === column)) {
                console.log(`${table}.${column} 列已存在，跳过`);
            } else {
                await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT DEFAULT ''`);
                console.log(`${table}.${column} 列添加成功`);
            }
        }

        db.close();
        process.exit(0);
    } catch (e) {
        console.error('迁移失败:', e);
        process.exit(1);
    }
})();
