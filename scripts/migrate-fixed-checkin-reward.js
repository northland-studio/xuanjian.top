/**
 * 签到奖励统一为固定 2 贡献点
 * 将 checkin_rewards 表中所有档位的 reward_points 更新为 2
 * 运行：node scripts/migrate-fixed-checkin-reward.js
 */
require('dotenv').config();
const db = require('../database');

(async () => {
    console.log('=== 更新前 ===');
    const before = await db.all('SELECT continuous_days, reward_points, description FROM checkin_rewards ORDER BY continuous_days');
    console.table(before);

    const result = await db.run('UPDATE checkin_rewards SET reward_points = 2');
    console.log(`\n[完成] 已更新 ${result.changes} 行，签到奖励统一为固定 2 贡献点`);

    console.log('\n=== 更新后 ===');
    const after = await db.all('SELECT continuous_days, reward_points, description FROM checkin_rewards ORDER BY continuous_days');
    console.table(after);
    db.close();
})();
