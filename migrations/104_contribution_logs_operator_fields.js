/**
 * 104 — 人工调整贡献点审计字段（幂等）
 *
 * 规范第十一条要求人工调整必须记录：操作者 / 目标用户 / 金额 / 理由 / 调整前余额 / 调整后余额 / 时间。
 * 现有 contribution_logs 已有 user_id、amount、type、ref_id、note、balance_after、created_at，
 * 这里补充 operator_id（操作者）与 balance_before（调整前余额），由 routes/contributions.js 人工调整接口写入。
 * 不修改任何历史数据。
 */
module.exports = {
    id: 104,
    name: 'contribution_logs_operator_fields',
    up: async (db) => {
        const table = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='contribution_logs'");
        if (!table) {
            console.log('  贡献点流水表不存在，跳过（由 init-db 创建后可重跑）');
            return;
        }
        const cols = (await db.all('PRAGMA table_info(contribution_logs)')).map(c => c.name);
        if (!cols.includes('operator_id')) {
            await db.exec('ALTER TABLE contribution_logs ADD COLUMN operator_id INTEGER');
            console.log('  + contribution_logs.operator_id');
        }
        if (!cols.includes('balance_before')) {
            await db.exec('ALTER TABLE contribution_logs ADD COLUMN balance_before INTEGER');
            console.log('  + contribution_logs.balance_before');
        }
    }
};
