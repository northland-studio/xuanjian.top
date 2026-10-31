/**
 * 换服集体贡献点折算（服务层）
 *
 * 业务：
 *  - 按比例折算式：每人新值 = 旧值 × 比例（按排名区间取不同比例，或全员同一比例）
 *  - 默认排除：集市托管账户（market_escrow）、系统账号（level < 0）、冻结账号
 *  - 安全：先建预览批次（不改数据）→ 人工确认 → 应用；应用后可撤销上一批（仅一批）
 *
 * 设计要点：
 *  - 排名按当前贡献点降序（同值按 id 升序），区间左闭右开写法统一为 [from, to]
 *  - 折算结果可为负？不允许：min_result 下限（默认 0）
 *  - 取整模式：round / floor / ceil
 *  - 每次变更都写 contribution_logs（type='admin'），便于审计与追溯
 */
const db = require('../database');
const logger = require('./logger');

const DEFAULT_EXCLUDE_USERNAMES = ['market_escrow', 'xuanjian_guild'];

function roundBy(v, mode) {
    if (mode === 'floor') return Math.floor(v);
    if (mode === 'ceil') return Math.ceil(v);
    return Math.round(v);
}

/** 取参与折算的成员列表（已排序并带排名） */
async function listCandidates({ scope = 'positive', excludeIds = [] } = {}) {
    const excludeSet = new Set((excludeIds || []).map(Number));
    // 系统账号与托管账户一律排除
    const sysRows = await db.all(
        "SELECT id, username FROM users WHERE level < 0 OR username IN (" + DEFAULT_EXCLUDE_USERNAMES.map(() => '?').join(',') + ')',
        DEFAULT_EXCLUDE_USERNAMES
    );
    sysRows.forEach((r) => excludeSet.add(r.id));

    const where = ['1=1'];
    const params = [];
    // 系统账号（level < 0）与托管账户一律不参与，直接在 SQL 里排除，
    // 避免依赖 excludeIds 或范围过滤（scope=positive 时贡献点 0 的系统账号本就不会出现）
    where.push('COALESCE(level, 0) >= 0');
    if (scope === 'positive') where.push('COALESCE(contribution,0) > 0');
    if (scope === 'active') where.push('COALESCE(is_frozen,0) = 0');

    const rows = await db.all(
        `SELECT id, username, nickname, COALESCE(contribution,0) AS contribution, COALESCE(level,0) AS level, COALESCE(is_frozen,0) AS is_frozen
           FROM users WHERE ${where.join(' AND ')}
          ORDER BY COALESCE(contribution,0) DESC, id ASC`,
        params
    );

    return rows
        .map((r) => ({ ...r, excluded: excludeSet.has(r.id) }))
        .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** 校验并规范化区间配置 */
function normalizeTiers(tiers) {
    if (!Array.isArray(tiers) || !tiers.length) throw Object.assign(new Error('区间配置不能为空'), { status: 400 });
    const out = tiers.map((t) => {
        const from = Number(t.from);
        const to = t.to === null || t.to === undefined || t.to === '' ? null : Number(t.to);
        const ratio = Number(t.ratio);
        if (!Number.isInteger(from) || from < 1) throw Object.assign(new Error('区间起始名次必须是 >=1 的整数'), { status: 400 });
        if (to !== null && (!Number.isInteger(to) || to < from)) throw Object.assign(new Error('区间结束名次必须 >= 起始名次'), { status: 400 });
        if (!Number.isFinite(ratio) || ratio < 0 || ratio > 10) throw Object.assign(new Error('比例需在 0 ~ 10 之间'), { status: 400 });
        return { from, to, ratio };
    }).sort((a, b) => a.from - b.from);

    // 不允许重叠
    for (let i = 1; i < out.length; i++) {
        const prev = out[i - 1];
        const cur = out[i];
        if (prev.to === null) throw Object.assign(new Error('只有一个区间可以不设上限（且必须是最后一段）'), { status: 400 });
        if (cur.from <= prev.to) throw Object.assign(new Error(`区间重叠：第 ${i} 段起始名次 ${cur.from} <= 上一段结束 ${prev.to}`), { status: 400 });
    }
    return out;
}

function ratioForRank(rank, { mode, uniformRatio, tiers }) {
    if (mode === 'uniform') return Number(uniformRatio);
    for (const t of tiers) {
        if (rank >= t.from && (t.to === null || rank <= t.to)) return t.ratio;
    }
    return null; // 不在任何区间 → 不参与
}

/**
 * 生成折算计划（不写业务数据）
 */
async function buildPlan({ mode, uniformRatio, tiers, scope = 'positive', excludeIds = [], roundMode = 'round', minResult = 0, includeZero = false }) {
    let normalizedTiers = null;
    if (mode === 'tiers') normalizedTiers = normalizeTiers(tiers);
    if (mode === 'uniform') {
        const r = Number(uniformRatio);
        if (!Number.isFinite(r) || r < 0 || r > 10) throw Object.assign(new Error('统一比例需在 0 ~ 10 之间'), { status: 400 });
    }

    const candidates = await listCandidates({ scope, excludeIds });
    const items = [];
    let skipped = 0;

    for (const u of candidates) {
        if (u.excluded) { skipped++; continue; }
        const ratio = ratioForRank(u.rank, { mode, uniformRatio, tiers: normalizedTiers });
        if (ratio === null) { skipped++; continue; }
        const before = Number(u.contribution) || 0;
        let after = roundBy(before * ratio, roundMode);
        if (after < Number(minResult)) after = Number(minResult);
        items.push({
            userId: u.id,
            username: u.username,
            nickname: u.nickname,
            rank: u.rank,
            beforeValue: before,
            ratio,
            afterValue: after,
            delta: Number((after - before).toFixed(2))
        });
    }

    const totalBefore = Number(items.reduce((s, i) => s + i.beforeValue, 0).toFixed(2));
    const totalAfter = Number(items.reduce((s, i) => s + i.afterValue, 0).toFixed(2));

    return {
        mode,
        uniformRatio: mode === 'uniform' ? Number(uniformRatio) : null,
        tiers: normalizedTiers,
        scope,
        excludeIds: excludeIds || [],
        roundMode,
        minResult: Number(minResult) || 0,
        items,
        skipped,
        affected: items.length,
        totalBefore,
        totalAfter,
        totalDelta: Number((totalAfter - totalBefore).toFixed(2))
    };
}

/** 保存为预览批次 */
async function createPreview(plan, { operatorId = null, note = '' } = {}) {
    return db.transaction(async () => {
        const r = await db.run(
            `INSERT INTO contribution_conversions
                (mode, status, uniform_ratio, tiers, scope, exclude_ids, round_mode, min_result,
                 affected, total_before, total_after, note, operator_id)
             VALUES (?, 'preview', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                plan.mode,
                plan.uniformRatio,
                plan.tiers ? JSON.stringify(plan.tiers) : null,
                plan.scope,
                JSON.stringify(plan.excludeIds || []),
                plan.roundMode,
                plan.minResult,
                plan.affected,
                plan.totalBefore,
                plan.totalAfter,
                String(note || '').slice(0, 300),
                operatorId
            ]
        );
        const convId = r.id;
        for (const it of plan.items) {
            await db.run(
                `INSERT INTO contribution_conversion_items
                    (conversion_id, user_id, username, nickname, rank, before_value, ratio, after_value, delta)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [convId, it.userId, it.username, it.nickname, it.rank, it.beforeValue, it.ratio, it.afterValue, it.delta]
            );
        }
        return convId;
    });
}

/** 应用某个预览批次（写入贡献点 + 流水） */
async function applyConversion(convId, operatorId) {
    const conv = await db.get('SELECT * FROM contribution_conversions WHERE id = ?', [convId]);
    if (!conv) throw Object.assign(new Error('批次不存在'), { status: 404 });
    if (conv.status !== 'preview') throw Object.assign(new Error(`批次状态为 ${conv.status}，不能重复应用`), { status: 409 });

    const items = await db.all('SELECT * FROM contribution_conversion_items WHERE conversion_id = ? ORDER BY rank', [convId]);
    if (!items.length) throw Object.assign(new Error('批次没有明细'), { status: 400 });

    await db.transaction(async () => {
        for (const it of items) {
            const u = await db.get('SELECT id, COALESCE(contribution,0) AS c FROM users WHERE id = ?', [it.user_id]);
            if (!u) continue;
            // 二次校验：应用时的当前值必须与预览时一致，否则说明期间被改动过
            if (Number(u.c) !== Number(it.before_value)) {
                throw Object.assign(
                    new Error(`用户 ${it.nickname || it.username} 的贡献点在预览后发生变化（${it.before_value} → ${u.c}），请重新生成预览`),
                    { status: 409 }
                );
            }
            await db.run('UPDATE users SET contribution = ? WHERE id = ?', [it.after_value, it.user_id]);
            const log = await db.run(
                `INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after)
                 VALUES (?, ?, 'admin', ?, ?, ?)`,
                [
                    it.user_id,
                    it.delta,
                    convId,
                    `换服贡献点折算（批次 #${convId}，档位 ×${it.ratio}）`,
                    it.after_value
                ]
            );
            await db.run('UPDATE contribution_conversion_items SET log_id = ? WHERE id = ?', [log.id, it.id]);
        }
        await db.run(
            "UPDATE contribution_conversions SET status = 'applied', applied_at = CURRENT_TIMESTAMP WHERE id = ?",
            [convId]
        );
    });

    return { id: convId, affected: items.length, totalBefore: conv.total_before, totalAfter: conv.total_after };
}

/** 撤销最近一次已应用的批次（只允许撤销没有被后续批次覆盖的那一批） */
async function revertConversion(convId, operatorId) {
    const conv = await db.get('SELECT * FROM contribution_conversions WHERE id = ?', [convId]);
    if (!conv) throw Object.assign(new Error('批次不存在'), { status: 404 });
    if (conv.status !== 'applied') throw Object.assign(new Error(`批次状态为 ${conv.status}，只能撤销已应用的批次`), { status: 409 });

    // 只允许撤销「最近一批已应用」的折算：用 id 比较（同秒内 applied_at 可能相同，
    // 用时间戳比较会漏判），避免撤销旧批次破坏后续批次的数据一致性
    const newer = await db.get(
        "SELECT id FROM contribution_conversions WHERE status = 'applied' AND id > ? ORDER BY id DESC LIMIT 1",
        [convId]
    );
    if (newer) {
        throw Object.assign(new Error(`已有更晚的折算批次 #${newer.id} 应用，撤销会破坏数据一致性，请先撤销它`), { status: 409 });
    }

    const items = await db.all('SELECT * FROM contribution_conversion_items WHERE conversion_id = ? ORDER BY rank', [convId]);

    await db.transaction(async () => {
        for (const it of items) {
            const u = await db.get('SELECT id, COALESCE(contribution,0) AS c FROM users WHERE id = ?', [it.user_id]);
            if (!u) continue;
            // 只回滚仍停留在折算后值的用户，避免覆盖之后的手工调整
            if (Number(u.c) !== Number(it.after_value)) {
                logger.warn(`[conversion] 撤销跳过用户 ${it.user_id}：当前值 ${u.c} 已被修改，不等于折算后 ${it.after_value}`);
                continue;
            }
            await db.run('UPDATE users SET contribution = ? WHERE id = ?', [it.before_value, it.user_id]);
            await db.run(
                `INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after)
                 VALUES (?, ?, 'admin', ?, ?, ?)`,
                [it.user_id, -it.delta, convId, `撤销换服折算（批次 #${convId}）`, it.before_value]
            );
        }
        await db.run("UPDATE contribution_conversions SET status = 'reverted', reverted_at = CURRENT_TIMESTAMP WHERE id = ?", [convId]);
    });

    return { id: convId, affected: items.length };
}

/** 批次列表 */
async function listConversions(limit = 20) {
    return db.all(
        `SELECT c.*, u.nickname AS operator_name FROM contribution_conversions c
           LEFT JOIN users u ON u.id = c.operator_id
          ORDER BY c.id DESC LIMIT ?`,
        [Math.min(100, Math.max(1, Number(limit) || 20))]
    );
}

/** 批次明细 */
async function getConversion(convId) {
    const conv = await db.get('SELECT * FROM contribution_conversions WHERE id = ?', [convId]);
    if (!conv) return null;
    const items = await db.all('SELECT * FROM contribution_conversion_items WHERE conversion_id = ? ORDER BY rank', [convId]);
    return { ...conv, items };
}

/** 删除预览批次 */
async function deletePreview(convId) {
    const conv = await db.get('SELECT * FROM contribution_conversions WHERE id = ?', [convId]);
    if (!conv) return false;
    if (conv.status !== 'preview') throw Object.assign(new Error('只能删除预览批次'), { status: 409 });
    await db.transaction(async () => {
        await db.run('DELETE FROM contribution_conversion_items WHERE conversion_id = ?', [convId]);
        await db.run('DELETE FROM contribution_conversions WHERE id = ?', [convId]);
    });
    return true;
}

module.exports = {
    listCandidates,
    normalizeTiers,
    buildPlan,
    createPreview,
    applyConversion,
    revertConversion,
    listConversions,
    getConversion,
    deletePreview,
    DEFAULT_EXCLUDE_USERNAMES
};
