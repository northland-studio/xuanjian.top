// 补偿：HOMO114514（id=36）在 2026-08-17 购买称号「V」（price=NULL）时，
// titles.js 执行 balance - NULL = NULL，导致余额被整体清空。
// 按事发时余额（63 点）补回，并补录一条 admin 流水。
// 用法：先备份数据库，再执行 node scripts/restore-user36-points.js
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));
const { addContributionLog } = require(path.join(__dirname, '..', 'lib', 'contribution'));

(async () => {
    const UID = 36;
    const AMOUNT = 63;
    try {
        const before = await db.get('SELECT username, contribution FROM users WHERE id = ?', [UID]);
        await db.transaction(async () => {
            await db.run('UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?', [AMOUNT, UID]);
            await addContributionLog(UID, AMOUNT, 'admin', 0, '补偿：购买称号「V」价格为空导致余额被清空');
        });
        const after = await db.get('SELECT username, contribution FROM users WHERE id = ?', [UID]);
        const last = await db.get('SELECT * FROM contribution_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1', [UID]);
        console.log('补偿前:', JSON.stringify(before));
        console.log('补偿后:', JSON.stringify(after));
        console.log('最新流水:', JSON.stringify(last));
    } catch (e) {
        console.error('补偿失败:', e);
        process.exit(1);
    } finally {
        db.close();
    }
})();
