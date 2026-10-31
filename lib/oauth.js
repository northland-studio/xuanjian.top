/**
 * OAuth 2.0 服务端工具库
 *
 * 设计要点：
 *  - client_secret 只存 SHA-256 哈希（密钥本身由服务端随机生成，熵足够，无需 bcrypt）
 *  - redirect_uri 严格全等匹配白名单（不做前缀匹配，防开放重定向）
 *  - 支持 PKCE（S256 / plain），公共客户端（如桌面启动器）必须用 PKCE
 *  - 授权码一次性、5 分钟过期、绑定 client_id / redirect_uri / PKCE
 *  - access_token 为 JWT（默认 2 小时），refresh_token 为随机串（哈希入库，30 天）
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../database');
const logger = require('./logger');

const JWT_SECRET = process.env.JWT_SECRET || 'xuanjian_guild_secret_key_2024';
const ACCESS_TTL = Number(process.env.OAUTH_ACCESS_TTL || 7200); // 2h
const REFRESH_TTL = Number(process.env.OAUTH_REFRESH_TTL || 2592000); // 30d
const CODE_TTL = Number(process.env.OAUTH_CODE_TTL || 300); // 5min

/** 可申请的权限范围；新增 scope 必须在这里声明 */
const SCOPES = {
    'read:user': '读取你的官网基础资料（昵称、头像、等级、称号）',
    'read:member': '查询你是否为公会成员及绑定的游戏 ID',
    'cdn:read': '获取公会 CDN 资源的临时访问凭证（下载启动器/游戏文件）'
};

const DEFAULT_SCOPE = 'read:user';
const ALL_SCOPES = Object.keys(SCOPES);

function now() {
    return Math.floor(Date.now() / 1000);
}

function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(v) {
    return crypto.createHash('sha256').update(String(v)).digest('hex');
}

/** 生成可直接给应用使用的密钥（只在创建/轮换时返回一次） */
function generateClientSecret() {
    return 'xj_' + randomToken(32);
}

function safeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

function parseList(v, fallback = []) {
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined || v === '') return fallback;
    try {
        const arr = JSON.parse(v);
        return Array.isArray(arr) ? arr : fallback;
    } catch {
        return fallback;
    }
}

/** 校验 PKCE：verifier 是客户端的原始串，challenge 是授权时提交的摘要 */
function verifyPkce(verifier, challenge, method = 'S256') {
    if (!challenge) return true; // 未启用 PKCE 的机密客户端
    if (!verifier) return false;
    if (String(method).toUpperCase() === 'PLAIN') return safeEqual(verifier, challenge);
    const digest = crypto.createHash('sha256').update(verifier).digest('base64url');
    return safeEqual(digest, challenge);
}

async function audit(event, { clientId = null, userId = null, ip = null, ua = null, detail = null } = {}) {
    try {
        await db.run(
            'INSERT INTO oauth_audit_logs (event, client_id, user_id, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?, ?)',
            [event, clientId, userId, ip, ua ? String(ua).slice(0, 200) : null, detail ? String(detail).slice(0, 500) : null]
        );
    } catch (e) {
        logger.warn?.('[oauth] 审计写入失败：' + e.message);
    }
}

async function getClient(clientId) {
    if (!clientId) return null;
    const row = await db.get('SELECT * FROM oauth_clients WHERE client_id = ?', [String(clientId)]);
    if (!row || !row.is_active) return null;
    return {
        ...row,
        redirectUris: parseList(row.redirect_uris),
        scopes: parseList(row.allowed_scopes)
    };
}

/** redirect_uri 必须与白名单中的某一项完全一致 */
function matchRedirect(client, redirectUri) {
    if (!redirectUri) return false;
    return client.redirectUris.some((u) => String(u) === String(redirectUri));
}

/** 申请的 scope 必须全部在应用允许范围内，否则取交集并告警 */
function resolveScopes(client, requested) {
    const req = parseList(String(requested || '').split(/[\s,+]+/).filter(Boolean), []);
    const allowed = client.scopes.length ? client.scopes : [DEFAULT_SCOPE];
    if (!req.length) return allowed;
    const granted = req.filter((s) => allowed.includes(s));
    return granted;
}

function issueAccessToken({ userId, username, level, clientId, scope }) {
    return jwt.sign(
        {
            typ: 'oauth_access',
            userId,
            username,
            level,
            client_id: clientId,
            scope: scope || DEFAULT_SCOPE
        },
        JWT_SECRET,
        { expiresIn: ACCESS_TTL }
    );
}

function verifyAccessToken(token) {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.typ && decoded.typ !== 'oauth_access') throw new Error('token 类型不正确');
    return decoded;
}

async function issueRefreshToken({ userId, clientId, scope }) {
    const raw = randomToken(32);
    await db.run(
        'INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)',
        [sha256(raw), clientId, userId, scope || DEFAULT_SCOPE, now() + REFRESH_TTL]
    );
    return raw;
}

async function consumeRefreshToken(raw, clientId) {
    const hash = sha256(raw);
    const row = await db.get('SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?', [hash]);
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at < now()) return null;
    if (clientId && row.client_id !== clientId) return null;
    return row;
}

async function revokeRefreshToken(raw) {
    const r = await db.run('UPDATE oauth_refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL', [sha256(raw)]);
    return (r.changes || 0) > 0;
}

/** 清理过期授权码与刷新令牌（由运行时定时调用或迁移时调用） */
async function cleanup() {
    const t = now();
    const a = await db.run('DELETE FROM oauth_codes WHERE expires_at < ?', [t - 600]);
    const b = await db.run('DELETE FROM oauth_refresh_tokens WHERE expires_at < ?', [t - 86400]);
    const c = await db.run("DELETE FROM oauth_audit_logs WHERE created_at < datetime('now', '-90 days')");
    return { codes: a.changes || 0, refresh: b.changes || 0, audit: c.changes || 0 };
}

module.exports = {
    SCOPES,
    ALL_SCOPES,
    DEFAULT_SCOPE,
    ACCESS_TTL,
    REFRESH_TTL,
    CODE_TTL,
    now,
    randomToken,
    sha256,
    generateClientSecret,
    safeEqual,
    parseList,
    verifyPkce,
    audit,
    getClient,
    matchRedirect,
    resolveScopes,
    issueAccessToken,
    verifyAccessToken,
    issueRefreshToken,
    consumeRefreshToken,
    revokeRefreshToken,
    cleanup
};
