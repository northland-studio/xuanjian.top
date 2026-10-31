/**
 * CDN 资源访问（会员鉴权）
 *
 * 面向 PCL2 定制启动器：先 OAuth 登录拿 access_token，再：
 *   GET  /api/cdn/manifest?prefix=launcher/      版本清单（文件列表）
 *   POST /api/cdn/sign { keys: [...], ttl: 1800 } 批量签名下载地址
 *   GET  /api/cdn/info                            CDN 域名与限额
 *
 * 鉴权要求：Bearer access_token，且 scope 含 cdn:read，且是公会成员（已绑定游戏 ID、未冻结、非系统账号）
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const oauth = require('../lib/oauth');
const cdn = require('../lib/cdn');

const router = express.Router();

function clientIp(req) {
    return (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
}

function bearer(req) {
    return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

/**
 * 会员校验中间件：解析令牌 → 检查 scope → 检查成员身份
 * 结果挂在 req.oauthUser / req.oauthScope
 */
async function requireMember(req, res, next) {
    try {
        const token = bearer(req);
        if (!token) return res.status(401).json({ ok: false, error: 'missing_token', hint: '请先通过 /api/oauth/authorize 获取 access_token' });

        let decoded;
        try {
            decoded = oauth.verifyAccessToken(token);
        } catch (e) {
            return res.status(401).json({ ok: false, error: 'invalid_token', hint: e.message === 'jwt expired' ? '令牌已过期，请刷新' : '令牌无效' });
        }

        const scopes = String(decoded.scope || '').split(/\s+/).filter(Boolean);
        if (!scopes.includes('cdn:read')) {
            return res.status(403).json({ ok: false, error: 'insufficient_scope', required: 'cdn:read', granted: scopes });
        }

        const user = await db.get(
            'SELECT id, username, nickname, level, game_id, is_frozen FROM users WHERE id = ?',
            [decoded.userId]
        );
        if (!user) return res.status(401).json({ ok: false, error: 'user_not_found' });

        const isMember = !user.is_frozen && Number(user.level) >= 0 && Boolean(user.game_id && String(user.game_id).trim());
        if (!isMember) {
            try {
                await oauth.audit('cdn_denied', {
                    clientId: decoded.client_id, userId: user.id, ip: clientIp(req), ua: req.headers['user-agent'] || '',
                    detail: user.is_frozen ? 'frozen' : (!user.game_id ? 'no_game_id' : 'not_member')
                });
            } catch {}
            return res.status(403).json({
                ok: false,
                error: 'not_member',
                reason: user.is_frozen ? 'frozen' : (!user.game_id ? 'no_game_id' : 'not_member'),
                hint: user.is_frozen ? '账号已被冻结，请联系管理员' : '请先在官网绑定游戏 ID 后再访问 CDN 资源'
            });
        }

        req.oauthUser = user;
        req.oauthScope = scopes;
        req.oauthClient = decoded.client_id || null;
        next();
    } catch (e) {
        logger.error('CDN 鉴权异常：' + (e && e.stack ? e.stack : e));
        res.status(500).json({ ok: false, error: 'server_error' });
    }
}

/** CDN 基础信息 */
router.get('/info', async (_req, res) => {
    res.json({ ok: true, ...cdn.info() });
});

/** 版本清单（需要会员） */
router.get('/manifest', requireMember, async (req, res) => {
    try {
        const prefix = String(req.query.prefix || '');
        const limit = Number(req.query.limit) || 500;
        const data = await cdn.listPrefix(prefix, limit);
        res.json({
            ok: true,
            ...data,
            cdn: { domain: cdn.info().domain, bucket: cdn.info().bucket },
            signTtl: cdn.DEFAULT_TTL,
            hint: '拿到 items[].key 后调用 POST /api/cdn/sign 换取下载地址'
        });
    } catch (e) {
        res.status(e.status || 500).json({ ok: false, error: e.message || '读取清单失败' });
    }
});

/** 批量签名（需要会员） */
router.post('/sign', requireMember, async (req, res) => {
    try {
        const { keys, ttl } = req.body || {};
        const data = cdn.signKeys(keys, ttl);
        res.json({
            ok: true,
            expires_at: data.expiresAt,
            expires_in: Math.max(0, data.expiresAt - Math.floor(Date.now() / 1000)),
            urls: data.urls,
            note: '签名 URL 在有效期内可直接下载，请勿外传'
        });
    } catch (e) {
        res.status(e.status || 500).json({ ok: false, error: e.message || '签名失败' });
    }
});

/** 单文件签名（便捷接口） */
router.get('/sign', requireMember, async (req, res) => {
    try {
        const key = String(req.query.key || '');
        if (!key) return res.status(400).json({ ok: false, error: '缺少 key' });
        const data = cdn.signKey(key.replace(/^\/+/, ''), req.query.ttl);
        res.json({ ok: true, url: data.url, expires_at: data.expiresAt });
    } catch (e) {
        res.status(e.status || 500).json({ ok: false, error: e.message || '签名失败' });
    }
});

module.exports = router;
