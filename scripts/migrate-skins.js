// 新增皮肤功能：为 users 表添加 skin_path 字段（Minecraft 皮肤路径）
const db = require('../database');

const run = async () => {
    try {
        // 检查字段是否已存在
        const cols = await db.all('PRAGMA table_info(users)');
        const hasSkin = cols.some(c => c.name === 'skin_path');
        if (hasSkin) {
            console.log('skin_path 字段已存在，无需迁移');
        } else {
            await db.run('ALTER TABLE users ADD COLUMN skin_path TEXT DEFAULT NULL');
            console.log('已为 users 表添加 skin_path 字段');
        }

        db.close();
        process.exit(0);
    } catch (e) {
        console.error('迁移失败:', e);
        process.exit(1);
    }
};

run();
