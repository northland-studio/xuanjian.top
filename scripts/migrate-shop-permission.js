/**
 * v2.3.0 商城重构迁移
 * 1. 重建 shop_items 表：type CHECK 扩展为 ('title','other','permission')，新增 duration_days（权限有效期天数）
 * 2. user_items 新增 expires_at（权限到期时间）
 *
 * 运行：node scripts/migrate-shop-permission.js
 */
require('dotenv').config();
const db = require('../database');

(async () => {
    await db.run('PRAGMA busy_timeout = 10000');

    // 关闭外键检查，便于重建被引用的 shop_items 表
    await db.run('PRAGMA foreign_keys = OFF');
    try {
        // 1. user_items 增加 expires_at
        const uiCols = await db.all('PRAGMA table_info(user_items)');
        if (!uiCols.some(c => c.name === 'expires_at')) {
            await db.run('ALTER TABLE user_items ADD COLUMN expires_at DATETIME DEFAULT NULL');
            console.log('[完成] user_items 已添加 expires_at 列');
        } else {
            console.log('[跳过] user_items 已存在 expires_at 列');
        }

        // 2. 重建 shop_items（扩展 type CHECK + duration_days）
        const siCols = await db.all('PRAGMA table_info(shop_items)');
        if (siCols.some(c => c.name === 'duration_days')) {
            console.log('[跳过] shop_items 已是新版结构');
        } else {
            // 动态读取现有列，兼容不同版本的 shop_items 结构
            const copyable = ['id', 'name', 'description', 'type', 'ref_id', 'price', 'image', 'stock', 'content', 'images', 'is_active', 'created_at', 'updated_at'];
            const existingCols = siCols.map(c => c.name);
            const cols = copyable.filter(c => existingCols.includes(c));
            await db.run('BEGIN');
            try {
                await db.run(`CREATE TABLE shop_items_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT,
                    type TEXT NOT NULL CHECK(type IN ('title', 'other', 'permission')),
                    ref_id INTEGER,
                    price INTEGER NOT NULL,
                    image TEXT,
                    stock INTEGER DEFAULT -1,
                    content TEXT,
                    images TEXT DEFAULT '[]',
                    duration_days INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);
                await db.run(`INSERT INTO shop_items_new (${cols.join(', ')})
                    SELECT ${cols.join(', ')} FROM shop_items`);
                await db.run('DROP TABLE shop_items');
                await db.run('ALTER TABLE shop_items_new RENAME TO shop_items');
                await db.run('COMMIT');
                const n = await db.get('SELECT COUNT(*) c FROM shop_items');
                console.log(`[完成] shop_items 已重建（type 支持 permission + duration_days），现有 ${n.c} 条记录`);
            } catch (e) {
                await db.run('ROLLBACK');
                console.error('[失败] shop_items 重建:', e.message);
                throw e;
            }
        }
    } catch (e) {
        await db.run('PRAGMA foreign_keys = ON');
        console.error('迁移失败:', e.message);
        process.exit(1);
    }

    await db.run('PRAGMA foreign_keys = ON');
    db.close();
    console.log('商城重构迁移全部完成');
})();
