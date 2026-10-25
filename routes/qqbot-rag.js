/**
 * QQ 群机器人 RAG 接入路由
 *
 * 鉴权：复用 routes/qqbot.js 的 X-Bot-Token（与其它机器人接口一致，不新增密钥）。
 * 与网站共用同一套 RAG 核心（lib/rag/ask.js），只有接入层与限流主体不同。
 *
 * POST /api/qqbot/rag/ask
 *   body: { question, userId, groupId?, isPrivate? }
 *   返回精简结构，不含索引内部数据、诊断或其他会话内容。
 */
const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { botTokenAuth } = require('./qqbot');
const ragAsk = require('../lib/rag/ask');

function errStatus(type) {
    if (type === 'rate_limited') return 429;
    if (type === 'budget_exceeded' || type === 'circuit_open') return 503;
    return 400;
}

router.post('/ask', botTokenAuth, async (req, res) => {
    try {
        const body = req.body || {};
        const question = String(body.question || '').trim();
        const userId = body.userId == null ? '' : String(body.userId).trim();
        const groupId = body.groupId == null ? '' : String(body.groupId).trim();
        const isPrivate = !!body.isPrivate;

        if (!question) return res.status(400).json({ ok: false, error: '缺少 question' });
        if (!userId) return res.status(400).json({ ok: false, error: '缺少 userId（用于上下文隔离）' });
        if (!isPrivate && !groupId) return res.status(400).json({ ok: false, error: '群聊必须提供 groupId' });

        const result = await ragAsk.ask({
            question,
            sourceType: isPrivate ? 'qq_private' : 'qq_group',
            subjectId: 'qq:' + userId,
            groupId: isPrivate ? null : groupId,
            conversationId: body.conversationId || null
        });

        if (!result.ok) {
            return res.status(errStatus(result.errorType)).json({
                ok: false,
                error: result.error,
                errorType: result.errorType
            });
        }

        // 机器人侧只给：回答、是否拒答、真实来源、会话 ID
        return res.json({
            ok: true,
            requestId: result.requestId,
            conversationId: result.conversationId,
            answer: result.answer,
            abstained: result.abstained,
            sources: (result.sources || []).map((s) => ({
                title: s.title,
                url: s.url,
                categoryPath: s.categoryPath
            })),
            latencyMs: result.latencyMs,
            cached: result.cached === true,
            degraded: result.degraded === true
        });
    } catch (e) {
        logger.error('QQ RAG 接口错误: ' + e.message);
        return res.status(500).json({ ok: false, error: '服务内部错误' });
    }
});

router.get('/health', botTokenAuth, async (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;
