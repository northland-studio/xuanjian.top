/**
 * OAuth 2.0 授权服务（v2）
 *
 * 标准授权码模式 + PKCE，面向两类应用：
 *  - 机密客户端（服务端应用，如 nork / northbooker）：持有 client_secret
 *  - 公共客户端（桌面启动器，如 PCL2 定制版）：无 secret，强制 PKCE
 *
 * 端点：
 *  GET  /api/oauth/authorize          授权页（未登录会引导登录）
 *  POST /api/oauth/authorize          用户同意，签发授权码
 *  POST /api/oauth/token              授权码换令牌 / 刷新令牌
 *  POST /api/oauth/revoke             吊销 refresh_token
 *  GET  /api/oauth/verify             校验 access_token（兼容旧接入方）
 *  GET  /api/oauth/userinfo           用户资料（按 scope 过滤）
 *  GET  /api/oauth/member             公会成员身份与游戏 ID 绑定情况
 *  GET  /api/oauth/scopes             可用 scope 列表
 *  管理端（管理员）：
 *  GET  /api/oauth/clients            应用列表
 *  POST /api/oauth/clients            注册应用（返回一次性密钥）
 *  PUT  /api/oauth/clients/:id        修改应用
 *  POST /api/oauth/clients/:id/rotate-secret  轮换密钥
 *  DELETE /api/oauth/clients/:id      停用应用
 *  GET  /api/oauth/audit              接入审计
 */
const express = require('express');
const crypto = require('crypto');
const logger = require('../lib/logger');
const db = require('../database');
const oauth = require('../lib/oauth');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

const GUILD_NAME = '玄剑公会';
const SITE = process.env.SITE_URL || 'https://xuanjian.top';

function clientIp(req) {
    return (req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
}

function ua(req) {
    return req.headers['user-agent'] || '';
}

function fail(res, status, error, description) {
    return res.status(status).json({ error, ...(description ? { error_description: description } : {}) });
}

/* ============================ 授权页 ============================ */

router.get('/authorize', async (req, res) => {
    const { client_id, redirect_uri, response_type, state, scope, code_challenge, code_challenge_method } = req.query;

    if (!client_id || !redirect_uri || response_type !== 'code') {
        return res.status(400).send(renderError('缺少必要参数', '需要 client_id、redirect_uri 与 response_type=code'));
    }

    const client = await oauth.getClient(client_id);
    if (!client) {
        return res.status(400).send(renderError('未知应用', `client_id「${escapeHtml(client_id)}」未注册或已停用`));
    }
    if (!oauth.matchRedirect(client, redirect_uri)) {
        await oauth.audit('authorize_reject_redirect', { clientId: client_id, ip: clientIp(req), ua: ua(req), detail: 'redirect_uri=' + redirect_uri });
        return res.status(400).send(renderError('回调地址不匹配', '该回调地址未在应用白名单中登记，请联系应用开发者或管理员。'));
    }
    // 公共客户端必须 PKCE
    if (!client.is_confidential && !code_challenge) {
        return res.status(400).send(renderError('缺少 PKCE 参数', '公共客户端（桌面/移动端）必须提供 code_challenge（推荐 S256）。'));
    }

    const granted = oauth.resolveScopes(client, scope);
    if (!granted.length) {
        return res.status(400).send(renderError('无可用权限', '申请的 scope 不在该应用允许范围内。'));
    }

    res.type('html').send(renderConsentPage({
        client, redirectUri: redirect_uri, state: state || '', scope: granted.join(' '),
        codeChallenge: code_challenge || '', codeChallengeMethod: (code_challenge_method || 'S256').toUpperCase()
    }));
});

router.post('/authorize', authMiddleware, async (req, res) => {
    try {
        const { client_id, redirect_uri, state, scope, code_challenge, code_challenge_method, decision } = req.body || {};
        if (decision === 'deny') {
            await oauth.audit('authorize_denied', { clientId: client_id, userId: req.userId, ip: clientIp(req), ua: ua(req) });
            return res.json({ ok: true, redirect: appendQuery(redirect_uri, { error: 'access_denied', state }) });
        }

        const client = await oauth.getClient(client_id);
        if (!client) return fail(res, 400, 'invalid_client', '应用未注册或已停用');
        if (!oauth.matchRedirect(client, redirect_uri)) return fail(res, 400, 'invalid_request', '回调地址不在白名单');
        if (!client.is_confidential && !code_challenge) return fail(res, 400, 'invalid_request', '公共客户端必须使用 PKCE');

        const granted = oauth.resolveScopes(client, scope);
        if (!granted.length) return fail(res, 400, 'invalid_scope', '没有可授予的权限');

        const code = oauth.randomToken(24);
        await db.run(
            `INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [code, client.client_id, req.userId, redirect_uri, granted.join(' '), code_challenge || null,
                code_challenge ? String(code_challenge_method || 'S256').toUpperCase() : null, oauth.now() + oauth.CODE_TTL]
        );
        await db.run('UPDATE oauth_clients SET last_used_at = CURRENT_TIMESTAMP WHERE client_id = ?', [client.client_id]);
        await oauth.audit('authorize_granted', {
            clientId: client.client_id, userId: req.userId, ip: clientIp(req), ua: ua(req),
            detail: 'scope=' + granted.join(' ')
        });

        res.json({ ok: true, redirect: appendQuery(redirect_uri, { code, state }) });
    } catch (e) {
        logger.error('OAuth authorize 失败：' + (e && e.stack ? e.stack : e));
        res.status(500).json({ error: 'server_error' });
    }
});

/* ============================ 令牌 ============================ */

router.post('/token', async (req, res) => {
    try {
        const body = req.body || {};
        const grantType = body.grant_type;

        if (grantType === 'refresh_token') return handleRefresh(req, res, body);
        if (grantType !== 'authorization_code') return fail(res, 400, 'unsupported_grant_type');

        const { code, client_id, client_secret, redirect_uri } = body;
        if (!code || !client_id) return fail(res, 400, 'invalid_request', '缺少 code 或 client_id');

        const client = await oauth.getClient(client_id);
        if (!client) return fail(res, 401, 'invalid_client');

        // 机密客户端校验 secret（支持 body 传参，兼容旧接入方）
        if (client.is_confidential) {
            if (!client_secret || !oauth.safeEqual(oauth.sha256(client_secret), client.client_secret_hash || '')) {
                await oauth.audit('token_invalid_secret', { clientId: client_id, ip: clientIp(req), ua: ua(req) });
                return fail(res, 401, 'invalid_client', 'client_secret 不正确');
            }
        }

        const row = await db.get('SELECT * FROM oauth_codes WHERE code = ?', [code]);
        if (!row) return fail(res, 400, 'invalid_grant', '授权码无效');
        if (row.used_at) {
            // 授权码复用视为攻击：连带作废该用户该应用的刷新令牌
            await db.run('UPDATE oauth_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE client_id = ? AND user_id = ? AND revoked_at IS NULL', [client_id, row.user_id]);
            await oauth.audit('code_reuse', { clientId: client_id, userId: row.user_id, ip: clientIp(req), ua: ua(req) });
            return fail(res, 400, 'invalid_grant', '授权码已被使用');
        }
        if (row.expires_at < oauth.now()) return fail(res, 400, 'invalid_grant', '授权码已过期');
        if (row.client_id !== client_id) return fail(res, 400, 'invalid_grant', '授权码与 client_id 不匹配');
        if (redirect_uri && row.redirect_uri !== redirect_uri) return fail(res, 400, 'invalid_grant', 'redirect_uri 与授权时不一致');

        // PKCE 校验：授权时带了 challenge，就必须带正确的 verifier
        if (row.code_challenge) {
            const verifier = body.code_verifier || req.query.code_verifier;
            if (!oauth.verifyPkce(verifier, row.code_challenge, row.code_challenge_method)) {
                await oauth.audit('pkce_failed', { clientId: client_id, userId: row.user_id, ip: clientIp(req), ua: ua(req) });
                return fail(res, 400, 'invalid_grant', 'PKCE 校验失败');
            }
        }

        await db.run('UPDATE oauth_codes SET used_at = CURRENT_TIMESTAMP WHERE code = ?', [code]);

        const user = await db.get('SELECT id, username, level, is_frozen FROM users WHERE id = ?', [row.user_id]);
        if (!user) return fail(res, 400, 'invalid_grant', '用户不存在');
        if (user.is_frozen) return fail(res, 403, 'access_denied', '账号已被冻结');

        const accessToken = oauth.issueAccessToken({
            userId: user.id, username: user.username, level: user.level, clientId: client_id, scope: row.scope
        });
        const refreshToken = await oauth.issueRefreshToken({ userId: user.id, clientId: client_id, scope: row.scope });

        await oauth.audit('token_issued', { clientId: client_id, userId: user.id, ip: clientIp(req), ua: ua(req), detail: 'scope=' + row.scope });

        res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: oauth.ACCESS_TTL,
            refresh_token: refreshToken,
            scope: row.scope || oauth.DEFAULT_SCOPE
        });
    } catch (e) {
        logger.error('OAuth token 失败：' + (e && e.stack ? e.stack : e));
        res.status(500).json({ error: 'server_error' });
    }
});

async function handleRefresh(req, res, body) {
    const { refresh_token, client_id, client_secret } = body;
    if (!refresh_token || !client_id) return fail(res, 400, 'invalid_request', '缺少 refresh_token 或 client_id');

    const client = await oauth.getClient(client_id);
    if (!client) return fail(res, 401, 'invalid_client');
    if (client.is_confidential) {
        if (!client_secret || !oauth.safeEqual(oauth.sha256(client_secret), client.client_secret_hash || '')) {
            return fail(res, 401, 'invalid_client');
        }
    }

    const row = await oauth.consumeRefreshToken(refresh_token, client_id);
    if (!row) return fail(res, 400, 'invalid_grant', 'refresh_token 无效或已过期');

    const user = await db.get('SELECT id, username, level, is_frozen FROM users WHERE id = ?', [row.user_id]);
    if (!user) return fail(res, 400, 'invalid_grant', '用户不存在');
    if (user.is_frozen) return fail(res, 403, 'access_denied', '账号已被冻结');

    // 轮换：旧 refresh 作废，发新的（防重放）
    await oauth.revokeRefreshToken(refresh_token);
    const accessToken = oauth.issueAccessToken({
        userId: user.id, username: user.username, level: user.level, clientId: client_id, scope: row.scope
    });
    const newRefresh = await oauth.issueRefreshToken({ userId: user.id, clientId: client_id, scope: row.scope });

    res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: oauth.ACCESS_TTL,
        refresh_token: newRefresh,
        scope: row.scope || oauth.DEFAULT_SCOPE
    });
}

router.post('/revoke', async (req, res) => {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return fail(res, 400, 'invalid_request', '缺少 refresh_token');
    const ok = await oauth.revokeRefreshToken(refresh_token);
    await oauth.audit('refresh_revoked', { ip: clientIp(req), ua: ua(req), detail: ok ? 'success' : 'not_found' });
    res.json({ ok: true });
});

/* ============================ 用户信息 ============================ */

async function loadUserForOauth(userId) {
    let user;
    try {
        user = await db.get(
            `SELECT u.id, u.username, u.nickname, u.avatar, u.level, u.contribution, u.game_id, u.email_verified,
                    u.is_frozen, t.name AS title_name
               FROM users u LEFT JOIN titles t ON t.id = u.equipped_title
              WHERE u.id = ?`,
            [userId]
        );
    } catch {
        user = await db.get(
            'SELECT id, username, nickname, avatar, level, contribution, game_id, email_verified, is_frozen FROM users WHERE id = ?',
            [userId]
        );
    }
    return user;
}

function avatarUrl(avatar) {
    if (!avatar) return `${SITE}/uploads/default-avatar.png`;
    return String(avatar).startsWith('http') ? avatar : `${SITE}${avatar}`;
}

function isMember(user) {
    // 成员判定：非系统账号、未冻结、已绑定游戏 ID
    if (!user) return false;
    if (user.is_frozen) return false;
    if (Number(user.level) < 0) return false;
    return Boolean(user.game_id && String(user.game_id).trim());
}

router.get('/verify', async (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!token) return res.status(401).json({ valid: false, error: 'missing_token' });

        let decoded;
        try {
            decoded = oauth.verifyAccessToken(token);
        } catch {
            return res.status(401).json({ valid: false, error: 'invalid_token' });
        }

        const user = await loadUserForOauth(decoded.userId);
        if (!user) return res.status(401).json({ valid: false, error: 'user_not_found' });

        res.json({
            valid: true,
            scope: decoded.scope || oauth.DEFAULT_SCOPE,
            client_id: decoded.client_id || null,
            user: {
                id: user.id,
                username: user.username,
                nickname: user.nickname || user.username,
                avatar: avatarUrl(user.avatar),
                level: user.level,
                title: user.title_name || null,
                contribution: user.contribution,
                is_member: isMember(user),
                game_id: user.game_id || null
            }
        });
    } catch (e) {
        logger.error('OAuth verify 失败：' + (e && e.stack ? e.stack : e));
        res.status(500).json({ valid: false, error: 'server_error' });
    }
});

router.get('/userinfo', async (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!token) return res.status(401).json({ error: 'missing_token' });
        const decoded = oauth.verifyAccessToken(token);
        const user = await loadUserForOauth(decoded.userId);
        if (!user) return res.status(404).json({ error: 'user_not_found' });

        const scopes = String(decoded.scope || '').split(/\s+/).filter(Boolean);
        const payload = { id: user.id, username: user.username, nickname: user.nickname || user.username, avatar: avatarUrl(user.avatar), level: user.level };
        if (scopes.includes('read:user')) {
            payload.title = user.title_name || null;
            payload.contribution = user.contribution;
            payload.email_verified = Boolean(user.email_verified);
        }
        if (scopes.includes('read:member')) {
            payload.is_member = isMember(user);
            payload.game_id = user.game_id || null;
        }
        res.json({ scope: decoded.scope || '', client_id: decoded.client_id || null, user: payload });
    } catch (e) {
        res.status(401).json({ error: 'invalid_token' });
    }
});

router.get('/member', async (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!token) return res.status(401).json({ ok: false, error: 'missing_token' });
        const decoded = oauth.verifyAccessToken(token);
        const scopes = String(decoded.scope || '').split(/\s+/);
        if (!scopes.includes('read:member') && !scopes.includes('cdn:read')) {
            return res.status(403).json({ ok: false, error: 'insufficient_scope' });
        }
        const user = await loadUserForOauth(decoded.userId);
        if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });

        const member = isMember(user);
        res.json({
            ok: true,
            is_member: member,
            user_id: user.id,
            nickname: user.nickname || user.username,
            level: user.level,
            game_id: user.game_id || null,
            is_frozen: Boolean(user.is_frozen),
            reason: member ? 'ok' : (user.is_frozen ? 'frozen' : (!user.game_id ? 'no_game_id' : 'not_member')),
            checked_at: new Date().toISOString()
        });
    } catch {
        res.status(401).json({ ok: false, error: 'invalid_token' });
    }
});

router.get('/scopes', (_req, res) => {
    res.json({ scopes: Object.entries(oauth.SCOPES).map(([id, desc]) => ({ id, description: desc })) });
});

/* ============================ 管理端 ============================ */

const adminGuard = [authMiddleware, adminMiddleware];

router.get('/clients', ...adminGuard, async (req, res) => {
    const rows = await db.all(`SELECT c.*, u.nickname AS creator_name FROM oauth_clients c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.id`);
    res.json({
        ok: true,
        clients: rows.map((r) => ({
            id: r.id,
            client_id: r.client_id,
            name: r.name,
            description: r.description,
            is_confidential: Boolean(r.is_confidential),
            redirect_uris: oauth.parseList(r.redirect_uris),
            allowed_scopes: oauth.parseList(r.allowed_scopes),
            owner_contact: r.owner_contact,
            homepage: r.homepage,
            is_active: Boolean(r.is_active),
            created_at: r.created_at,
            last_used_at: r.last_used_at,
            creator_name: r.creator_name,
            has_secret: Boolean(r.client_secret_hash)
        }))
    });
});

router.post('/clients', ...adminGuard, async (req, res) => {
    try {
        const b = req.body || {};
        const clientId = String(b.client_id || '').trim();
        if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(clientId)) {
            return res.status(400).json({ ok: false, error: 'client_id 只能是小写字母/数字/-/_/.，长度 2~64' });
        }
        const exists = await db.get('SELECT id FROM oauth_clients WHERE client_id = ?', [clientId]);
        if (exists) return res.status(409).json({ ok: false, error: 'client_id 已存在' });

        const redirectUris = oauth.parseList(b.redirect_uris);
        if (!redirectUris.length) return res.status(400).json({ ok: false, error: '至少需要一个 redirect_uris' });
        for (const u of redirectUris) {
            if (!/^(https?:\/\/|[\w.-]+:\/\/)/.test(String(u))) {
                return res.status(400).json({ ok: false, error: 'redirect_uri 必须是完整 URI：' + u });
            }
        }
        const scopes = oauth.parseList(b.allowed_scopes, [oauth.DEFAULT_SCOPE]).filter((s) => oauth.ALL_SCOPES.includes(s));
        if (!scopes.length) return res.status(400).json({ ok: false, error: 'allowed_scopes 至少包含一个有效 scope：' + oauth.ALL_SCOPES.join(', ') });

        const confidential = b.is_confidential === undefined ? true : Boolean(b.is_confidential);
        const secret = confidential ? oauth.generateClientSecret() : null;

        const r = await db.run(
            `INSERT INTO oauth_clients (client_id, name, description, client_secret_hash, is_confidential, redirect_uris, allowed_scopes, owner_contact, homepage, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [clientId, String(b.name || clientId).slice(0, 100), String(b.description || '').slice(0, 500),
                secret ? oauth.sha256(secret) : null, confidential ? 1 : 0, JSON.stringify(redirectUris), JSON.stringify(scopes),
                String(b.owner_contact || '').slice(0, 200), String(b.homepage || '').slice(0, 300), req.userId]
        );
        await oauth.audit('client_created', { clientId, userId: req.userId, ip: clientIp(req), ua: ua(req) });

        res.status(201).json({
            ok: true,
            id: r.id,
            client_id: clientId,
            client_secret: secret, // 仅此一次返回
            note: secret ? '请立即保存 client_secret，之后无法再次查看' : '公共客户端（PKCE），无 secret'
        });
    } catch (e) {
        logger.error('注册 OAuth 应用失败：' + (e && e.stack ? e.stack : e));
        res.status(500).json({ ok: false, error: '注册失败' });
    }
});

router.put('/clients/:id', ...adminGuard, async (req, res) => {
    const row = await db.get('SELECT * FROM oauth_clients WHERE id = ?', [Number(req.params.id)]);
    if (!row) return res.status(404).json({ ok: false, error: '应用不存在' });
    const b = req.body || {};
    const redirectUris = b.redirect_uris === undefined ? oauth.parseList(row.redirect_uris) : oauth.parseList(b.redirect_uris);
    const scopes = b.allowed_scopes === undefined ? oauth.parseList(row.allowed_scopes) : oauth.parseList(b.allowed_scopes).filter((s) => oauth.ALL_SCOPES.includes(s));
    await db.run(
        `UPDATE oauth_clients SET name = ?, description = ?, redirect_uris = ?, allowed_scopes = ?, owner_contact = ?, homepage = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [
            b.name === undefined ? row.name : String(b.name).slice(0, 100),
            b.description === undefined ? row.description : String(b.description).slice(0, 500),
            JSON.stringify(redirectUris),
            JSON.stringify(scopes.length ? scopes : oauth.parseList(row.allowed_scopes)),
            b.owner_contact === undefined ? row.owner_contact : String(b.owner_contact).slice(0, 200),
            b.homepage === undefined ? row.homepage : String(b.homepage).slice(0, 300),
            b.is_active === undefined ? row.is_active : (b.is_active ? 1 : 0),
            row.id
        ]
    );
    await oauth.audit('client_updated', { clientId: row.client_id, userId: req.userId, ip: clientIp(req) });
    res.json({ ok: true });
});

router.post('/clients/:id/rotate-secret', ...adminGuard, async (req, res) => {
    const row = await db.get('SELECT * FROM oauth_clients WHERE id = ?', [Number(req.params.id)]);
    if (!row) return res.status(404).json({ ok: false, error: '应用不存在' });
    if (!row.is_confidential) return res.status(400).json({ ok: false, error: '公共客户端（PKCE）无密钥' });
    const secret = oauth.generateClientSecret();
    await db.run('UPDATE oauth_clients SET client_secret_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [oauth.sha256(secret), row.id]);
    await oauth.audit('client_secret_rotated', { clientId: row.client_id, userId: req.userId, ip: clientIp(req) });
    res.json({ ok: true, client_secret: secret, note: '旧密钥立即失效，请同步更新到应用配置' });
});

router.delete('/clients/:id', ...adminGuard, async (req, res) => {
    const row = await db.get('SELECT * FROM oauth_clients WHERE id = ?', [Number(req.params.id)]);
    if (!row) return res.status(404).json({ ok: false, error: '应用不存在' });
    await db.run('UPDATE oauth_clients SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
    await oauth.audit('client_disabled', { clientId: row.client_id, userId: req.userId, ip: clientIp(req) });
    res.json({ ok: true, note: '应用已停用，现有令牌仍有效至过期' });
});

router.get('/audit', ...adminGuard, async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = await db.all(
        `SELECT a.*, u.nickname AS user_nickname FROM oauth_audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`,
        [limit]
    );
    res.json({ ok: true, logs: rows });
});

/* ============================ 页面渲染 ============================ */

function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function appendQuery(uri, params) {
    try {
        const u = new URL(uri);
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, v);
        });
        return u.toString();
    } catch {
        const qs = Object.entries(params || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        return uri + (uri.includes('?') ? '&' : '?') + qs;
    }
}

function renderError(title, desc) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · ${GUILD_NAME}</title><style>
:root{--primary:#004aad;--bg:#f6f8fb;--card:#fff;--text:#1e293b;--text-secondary:#64748b;--border:#e2e8f0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:var(--card);border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.12);max-width:460px;width:100%;padding:36px 32px;text-align:center;border:1px solid var(--border)}
h1{font-size:19px;margin-bottom:12px;color:#dc2626}p{font-size:14px;line-height:1.8;color:var(--text-secondary)}
.brand{margin-top:22px;font-size:12px;color:var(--text-secondary)}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(desc)}</p><div class="brand">${GUILD_NAME} · 统一登录</div></div></body></html>`;
}

function renderConsentPage({ client, redirectUri, state, scope, codeChallenge, codeChallengeMethod }) {
    const scopeList = scope.split(' ').filter(Boolean);
    const scopeHtml = scopeList.map((s) => `<li><code>${escapeHtml(s)}</code><span>${escapeHtml(oauth.SCOPES[s] || '未知权限')}</span></li>`).join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>授权 ${escapeHtml(client.name)} · ${GUILD_NAME}</title><style>
:root{--primary:#004aad;--bg:#f6f8fb;--card:#fff;--text:#1e293b;--text-secondary:#64748b;--border:#e2e8f0;--radius:14px}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:var(--card);border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.12);max-width:520px;width:100%;padding:32px;border:1px solid var(--border)}
h1{font-size:20px;margin-bottom:6px}.sub{font-size:13px;color:var(--text-secondary);margin-bottom:20px}
.app{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;margin-bottom:18px}
.app-badge{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#004aad,#06c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex:none}
.app-name{font-weight:600;font-size:14px}.app-desc{font-size:12px;color:var(--text-secondary);margin-top:2px}
.scopes{list-style:none;margin:0 0 18px}.scopes li{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px dashed var(--border);font-size:13px}
.scopes li:last-child{border-bottom:none}.scopes code{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:2px 7px;font-size:12px;flex:none}
.scopes span{color:var(--text-secondary);font-size:12.5px}
.actions{display:flex;gap:10px;margin-top:8px}
button{flex:1;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer;transition:.18s}
.primary{background:var(--primary);color:#fff}.primary:hover{background:#003a87}
.ghost{background:var(--bg);color:var(--text-secondary);border:1px solid var(--border)}.ghost:hover{color:var(--text)}
.tip{margin-top:16px;font-size:11.5px;color:var(--text-secondary);line-height:1.7;word-break:break-all}
.err{margin-top:14px;padding:10px 12px;border-radius:9px;background:#fef2f2;color:#dc2626;font-size:12.5px;display:none}
.brand{margin-top:20px;text-align:center;font-size:11.5px;color:var(--text-secondary)}
</style></head><body>
<div class="card">
  <h1>授权登录</h1>
  <div class="sub">以下应用请求访问你的 ${GUILD_NAME} 账号</div>
  <div class="app">
    <div class="app-badge">${escapeHtml((client.name || 'A').slice(0, 1).toUpperCase())}</div>
    <div><div class="app-name">${escapeHtml(client.name)}</div><div class="app-desc">${escapeHtml(client.description || client.client_id)}</div></div>
  </div>
  <ul class="scopes">${scopeHtml}</ul>
  <div class="actions">
    <button class="ghost" id="deny">拒绝</button>
    <button class="primary" id="allow">同意授权</button>
  </div>
  <div class="err" id="err"></div>
  <div class="tip">授权后将跳转回：${escapeHtml(redirectUri)}</div>
  <div class="brand">${GUILD_NAME} · 统一登录（OAuth 2.0）</div>
</div>
<script>
(function () {
  var payload = {
    client_id: ${JSON.stringify(client.client_id)},
    redirect_uri: ${JSON.stringify(redirectUri)},
    state: ${JSON.stringify(state)},
    scope: ${JSON.stringify(scope)},
    code_challenge: ${JSON.stringify(codeChallenge)},
    code_challenge_method: ${JSON.stringify(codeChallengeMethod)}
  };
  var err = document.getElementById('err');
  function showErr(m) { err.style.display = 'block'; err.textContent = m; }
  function getToken() {
    try { return localStorage.getItem('token') || ''; } catch (e) { return ''; }
  }
  async function submit(decision) {
    var token = getToken();
    if (!token) {
      // 未登录：跳官网登录页，登录后回到本授权页
      location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    try {
      var res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(Object.assign({}, payload, { decision: decision }))
      });
      var data = await res.json();
      if (data.redirect) { location.href = data.redirect; return; }
      if (data.error === 'invalid_token' || data.error === 'missing_token' || res.status === 401) {
        try { localStorage.removeItem('token'); } catch (e) {}
        location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search);
        return;
      }
      showErr(data.error_description || data.error || '授权失败');
    } catch (e) { showErr('网络错误，请稍后重试'); }
  }
  document.getElementById('allow').addEventListener('click', function () { submit('allow'); });
  document.getElementById('deny').addEventListener('click', function () { submit('deny'); });
})();
</script></body></html>`;
}

module.exports = router;
