// 迁移：users 表添加 game_id 字段（游戏ID，皮肤模型头顶显示的名字，留空时用用户名）
const db = require('../database');

(async () => {
    try {
        const cols = await db.all('PRAGMA table_info(users)');
        if (cols.some(c => c.name === 'game_id')) {
            console.log('game_id 字段已存在，跳过');
        } else {
            await db.run('ALTER TABLE users ADD COLUMN game_id TEXT DEFAULT ""');
            console.log('game_id 字段添加成功');
        }
        const check = await db.get('SELECT COUNT(*) AS cnt FROM users WHERE game_id IS NOT NULL AND game_id != ""');
        console.log(`当前已设置游戏ID的用户数: ${check.cnt}`);
        db.close();
        process.exit(0);
    } catch (e) {
        console.error('迁移失败:', e);
        process.exit(1);
    }
})();
