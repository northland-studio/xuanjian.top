/**
 * 人员代系解析工具
 * 根据用户的 created_at 匹配 generations 配置表的区间；若 users.generation 已手动指定则优先使用手动值。
 *
 * 返回结构带日期区间，便于档案页/导出显示成「第五期(2026-07-01 ~ 至今)」：
 *   { name, color, manual, start_date, end_date, range }
 * 其中 range 是可直接展示的区间文案（end_date 为空表示「至今」）。
 */
const db = require('../database');

/** 拼区间文案：2026-05-01 ~ 2026-06-30 / 2026-07-01 ~ 至今 / 空串（未配置区间） */
function buildRange(startDate, endDate) {
    const start = startDate ? String(startDate).slice(0, 10) : '';
    const end = endDate ? String(endDate).slice(0, 10) : '';
    if (start && end) return `${start} ~ ${end}`;
    if (start) return `${start} ~ 至今`;
    if (end) return `? ~ ${end}`;
    return '';
}

/** 获取某用户的代系（优先手动指定，否则按 created_at 自动判定） */
async function resolveGeneration(user) {
    if (!user) return null;
    // 手动指定优先：从配置表按名称匹配颜色与区间
    if (user.generation) {
        const manual = await db.get(
            `SELECT * FROM generations WHERE name = ? ORDER BY sort_order LIMIT 1`,
            [user.generation]
        );
        return {
            name: user.generation,
            color: manual?.color || null,
            manual: true,
            start_date: manual?.start_date || null,
            end_date: manual?.end_date || null,
            range: buildRange(manual?.start_date, manual?.end_date),
        };
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
        return {
            name: g.name,
            color: g.color,
            manual: false,
            start_date: g.start_date || null,
            end_date: g.end_date || null,
            range: buildRange(g.start_date, g.end_date),
        };
    }
    // 未匹配任何区间
    return null;
}

/** 获取所有代系配置（管理后台用） */
async function listGenerations() {
    return await db.all(`SELECT * FROM generations ORDER BY sort_order, start_date`);
}

module.exports = { resolveGeneration, listGenerations, buildRange };
