/**
 * 七牛私有空间 · CDN 临时访问凭证
 *
 * 用途：启动器/客户端先通过 OAuth 证明「是公会成员」，再换取短时效签名 URL，
 * 避免把 CDN 域名或 token 长期公开，防止资源被站外滥用。
 *
 * 依赖 .env：
 *   QINIU_ACCESS_KEY / QINIU_SECRET_KEY
 *   CDN_BUCKET（默认沿用 QINIU_BUCKET）
 *   CDN_DOMAIN（默认沿用 QINIU_DOMAIN）
 *   CDN_SIGN_TTL（默认 1800 秒，最大 3600）
 */
const qiniu = require('qiniu');
const logger = require('./logger');

const accessKey = process.env.QINIU_ACCESS_KEY || '';
const secretKey = process.env.QINIU_SECRET_KEY || '';
const bucket = process.env.CDN_BUCKET || process.env.QINIU_BUCKET || 'xuanjian-top';
const domain = (process.env.CDN_DOMAIN || process.env.QINIU_DOMAIN || 'https://cdn.xuanjian.top').replace(/\/+$/, '');
const DEFAULT_TTL = Number(process.env.CDN_SIGN_TTL || 1800);
const MAX_TTL = 3600;
const MAX_BATCH = 200;

const enabled = Boolean(accessKey && secretKey);

let mac = null;
let config = null;
let bucketManager = null;
if (enabled) {
    mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
    config = new qiniu.conf.Config();
    config.zone = qiniu.zone.Zone_as0;
    config.useHttpsDomain = true;
    bucketManager = new qiniu.rs.BucketManager(mac, config);
}

function isEnabled() {
    return enabled;
}

function info() {
    return { enabled, bucket, domain, defaultTtl: DEFAULT_TTL, maxTtl: MAX_TTL, maxBatch: MAX_BATCH };
}

/** 生成单个 key 的私有下载签名 URL */
function signKey(key, ttlSeconds = DEFAULT_TTL) {
    if (!enabled) throw Object.assign(new Error('CDN 未配置：缺少 QINIU_ACCESS_KEY / QINIU_SECRET_KEY'), { status: 503 });
    const ttl = Math.min(MAX_TTL, Math.max(30, Number(ttlSeconds) || DEFAULT_TTL));
    const deadline = Math.floor(Date.now() / 1000) + ttl;
    return { url: bucketManager.privateDownloadUrl(domain, key, deadline), expiresAt: deadline };
}

/** 批量签名（客户端下载多个文件时用） */
function signKeys(keys, ttlSeconds) {
    if (!Array.isArray(keys) || !keys.length) throw Object.assign(new Error('keys 不能为空'), { status: 400 });
    if (keys.length > MAX_BATCH) throw Object.assign(new Error(`一次最多签名 ${MAX_BATCH} 个文件`), { status: 400 });
    const out = {};
    let expiresAt = 0;
    for (const raw of keys) {
        const key = String(raw || '').replace(/^\/+/, '');
        if (!key || key.includes('..')) throw Object.assign(new Error('非法 key：' + key), { status: 400 });
        const r = signKey(key, ttlSeconds);
        out[key] = r.url;
        expiresAt = r.expiresAt;
    }
    return { urls: out, expiresAt };
}

/** 列出某个前缀下的文件（用作版本清单） */
function listPrefix(prefix = '', limit = 500) {
    if (!enabled) throw Object.assign(new Error('CDN 未配置'), { status: 503 });
    const options = { prefix: String(prefix || '').replace(/^\/+/, ''), limit: Math.min(1000, Math.max(1, Number(limit) || 500)) };
    return new Promise((resolve, reject) => {
        bucketManager.listPrefix(bucket, options, (err, respBody, respInfo) => {
            if (err) {
                logger.error('七牛列目录失败：' + err.message);
                return reject(Object.assign(new Error('读取 CDN 清单失败'), { status: 502 }));
            }
            if (respInfo.statusCode !== 200) {
                logger.error('七牛列目录返回 ' + respInfo.statusCode + '：' + JSON.stringify(respBody).slice(0, 300));
                return reject(Object.assign(new Error('读取 CDN 清单失败（' + respInfo.statusCode + '）'), { status: 502 }));
            }
            const items = (respBody.items || []).map((it) => ({ key: it.key, size: it.fsize, hash: it.hash, mtime: it.putTime }));
            resolve({ prefix: options.prefix, count: items.length, marker: respBody.marker || null, items });
        });
    });
}

module.exports = { isEnabled, info, signKey, signKeys, listPrefix, DEFAULT_TTL, MAX_TTL, MAX_BATCH };
