/**
 * 人员代系解析工具
 * 根据用户的 created_at 匹配 generations 配置表的区间；若 users.generation 已手动指定则优先使用手动值。
 */
const db = require('../database');

/** 获取某用户的代系（优先手动指定，否则按 created_at 自动判定） */
async function resolveGeneration(user) {
    if (!user) return null;
    // 手动指定优先：从配置表按名称匹配颜色
    if (user.generation) {
        const manual = await db.get(
            `SELECT * FROM generations WHERE name = ? ORDER BY sort_order LIMIT 1`,
            [user.generation]
        );
        return { name: user.generation, color: manual?.color || null, manual: true };
    }
    const created = user.created_at ? String(user.created_at).slice(0, 10) : null;
    if (!created) return null;
    const gens = await db.all(
        `SELECT * FROM generations ORDER BY sort_order, start_date`
    );
    for (const g of gens) {
        const start = g.start_date ? String(g.start_date).slice(0, 10) : null;
        const end = g.end_date ? String(g.end_date).slice(0, 10) : null;
        if (start && created < start) continue;
        if (end && created > end) continue;
        return { name: g.name, color: g.color, manual: false };
    }
    // 未匹配任何区间
    return null;
}

/** 获取所有代系配置（管理后台用） */
async function listGenerations() {
    return await db.all(`SELECT * FROM generations ORDER BY sort_order, start_date`);
}

module.exports = { resolveGeneration, listGenerations };
