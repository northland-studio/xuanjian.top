/**
 * 贡献点审计日志公共函数
 * 所有贡献点变动入口统一调用 addContributionLog 记录流水
 */
const db = require('../database');
const { getLocalTimestamp } = require('../database');

/**
 * 记录一条贡献点变动日志
 * @param {number} userId 用户 ID
 * @param {number} amount 变动数量（正为增加，负为减少）
 * @param {string} type   claim 申报 / task 任务 / transfer_in 转入 / transfer_out 转出 / purchase 消费 / reward 签到奖励 / admin 管理调整
 * @param {number} refId  关联记录 ID（申报 ID / 任务 ID / 转账 ID / 商品 ID 等）
 * @param {string} note   备注
 */
async function addContributionLog(userId, amount, type, refId = 0, note = '') {
    const user = await db.get('SELECT COALESCE(contribution, 0) AS contribution FROM users WHERE id = ?', [userId]);
    const balanceAfter = user?.contribution ?? 0;
    await db.run(
        `INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, amount, type, refId, note || '', balanceAfter, getLocalTimestamp()]
    );
}

module.exports = { addContributionLog };
