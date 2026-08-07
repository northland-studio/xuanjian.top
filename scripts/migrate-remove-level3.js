// 删除 3 级用户角色：将所有 level = 3 的用户降为 0 级（普通用户）
// 原 3 级 = 普通用户 + 日报发送权限，现统一并入 0 级
const db = require('../database');

const run = async () => {
    try {
        const affected = await db.run(
            'UPDATE users SET level = 0, updated_at = ? WHERE level = 3',
            [db.getLocalTimestamp()]
        );
        console.log(`已将 ${affected.changes} 个 3 级用户降为 0 级（普通用户）`);

        const remaining = await db.get('SELECT COUNT(*) AS cnt FROM users WHERE level = 3');
        console.log(`剩余 3 级用户: ${remaining.cnt}`);

        db.close();
        process.exit(0);
    } catch (e) {
        console.error('迁移失败:', e);
        process.exit(1);
    }
};

run();
