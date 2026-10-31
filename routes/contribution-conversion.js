/**
 * 换服集体贡献点折算 · API
 *
 * 权限：管理员（level >= 1）与超级管理员均可执行
 *  GET  /api/contributions/conversion/candidates   预览参与名单与排名
 *  POST /api/contributions/conversion/preview      生成预览批次（不写业务数据）
 *  GET  /api/contributions/conversion/list         批次列表
 *  GET  /api/contributions/conversion/:id          批次明细
 *  POST /api/contributions/conversion/:id/apply    应用
 *  POST /api/contributions/conversion/:id/revert   撤销
 *  DELETE /api/contributions/conversion/:id        删除预览
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const conv = require('../lib/contribution-conversion');

const router = express.Router();
// 管理员（level >= 1）与超级管理员均可执行折算
const guard = [authMiddleware, adminMiddleware];

function handle(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (e) {
            const status = e.status || 500;
            if (status >= 500) logger.error('换服折算接口错误: ' + (e && e.stack ? e.stack : e));
            res.status(status).json({ ok: false, error: e.message || '服务内部错误' });
        }
    };
}

/** 候选名单（含排名与是否被排除） */
router.get('/candidates', ...guard, handle(async (req, res) => {
    const scope = String(req.query.scope || 'positive');
    const rows = await conv.listCandidates({ scope });
    const totalUsers = await db.get('SELECT COUNT(*) AS c FROM users');
    const withPoints = await db.get('SELECT COUNT(*) AS c FROM users WHERE COALESCE(contribution,0) > 0');
    const sumPoints = await db.get('SELECT COALESCE(SUM(contribution),0) AS s FROM users');
    res.json({
        ok: true,
        scope,
        users: rows,
        stats: {
            totalUsers: totalUsers.c,
            withPoints: withPoints.c,
            totalPoints: Number(Number(sumPoints.s).toFixed(2)),
            excluded: rows.filter((r) => r.excluded).length,
            participants: rows.filter((r) => !r.excluded).length
        },
        defaultExcludes: conv.DEFAULT_EXCLUDE_USERNAMES
    });
}));

/** 生成预览 */
router.post('/preview', ...guard, handle(async (req, res) => {
    const b = req.body || {};
    const plan = await conv.buildPlan({
        mode: b.mode === 'tiers' ? 'tiers' : 'uniform',
        uniformRatio: b.uniformRatio,
        tiers: b.tiers,
        scope: b.scope || 'positive',
        excludeIds: Array.isArray(b.excludeIds) ? b.excludeIds : [],
        roundMode: ['round', 'floor', 'ceil'].includes(b.roundMode) ? b.roundMode : 'round',
        minResult: Number(b.minResult) || 0
    });

    if (!plan.items.length) {
        return res.status(400).json({ ok: false, error: '按当前条件没有任何成员参与折算（检查区间名次或比例）' });
    }

    const convId = await conv.createPreview(plan, { operatorId: req.userId, note: b.note });
    res.status(201).json({
        ok: true,
        conversionId: convId,
        summary: {
            affected: plan.affected,
            skipped: plan.skipped,
            totalBefore: plan.totalBefore,
            totalAfter: plan.totalAfter,
            totalDelta: plan.totalDelta,
            mode: plan.mode,
            uniformRatio: plan.uniformRatio,
            tiers: plan.tiers,
            roundMode: plan.roundMode,
            minResult: plan.minResult
        },
        items: plan.items.slice(0, 200)
    });
}));

/** 批次列表 */
router.get('/list', ...guard, handle(async (req, res) => {
    const rows = await conv.listConversions(Number(req.query.limit) || 20);
    res.json({ ok: true, conversions: rows });
}));

/** 批次明细 */
router.get('/:id', ...guard, handle(async (req, res) => {
    const row = await conv.getConversion(Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: '批次不存在' });
    res.json({ ok: true, conversion: row });
}));

/** 应用 */
router.post('/:id/apply', ...guard, handle(async (req, res) => {
    const r = await conv.applyConversion(Number(req.params.id), req.userId);
    await db.run('INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after) VALUES (?, 0, ?, ?, ?, 0)', [
        req.userId,
        'admin',
        r.id,
        `管理员应用换服折算批次 #${r.id}（${r.affected} 人）`
    ]).catch(() => {});
    res.json({ ok: true, ...r });
}));

/** 撤销 */
router.post('/:id/revert', ...guard, handle(async (req, res) => {
    const r = await conv.revertConversion(Number(req.params.id), req.userId);
    res.json({ ok: true, ...r });
}));

/** 删除预览 */
router.delete('/:id', ...guard, handle(async (req, res) => {
    const ok = await conv.deletePreview(Number(req.params.id));
    if (!ok) return res.status(404).json({ ok: false, error: '批次不存在' });
    res.json({ ok: true });
}));

module.exports = router;
