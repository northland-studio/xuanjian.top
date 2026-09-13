/**
 * 聊天媒体上传/删除工具
 *  - 图片：用 sharp 压缩（限制尺寸/质量）后直传七牛
 *  - 语音：原样直传七牛（webm/ogg，限制时长由前端控制 ≤60s）
 * 全部返回 CDN 公开 URL。
 *  - 删除：支持按 key / 按 CDN URL 删除对象，用于过期清理与用户主动删除，避免对象存储只增不减
 */
const qiniu = require('qiniu');
const sharp = require('sharp');
const crypto = require('crypto');
const logger = require('./logger');

const ACCESS_KEY = process.env.QINIU_ACCESS_KEY || '';
const SECRET_KEY = process.env.QINIU_SECRET_KEY || '';
const BUCKET = process.env.QINIU_BUCKET || 'xuanjian-top';
const DOMAIN = (process.env.QINIU_DOMAIN || 'https://cdn.xuanjian.top').replace(/\/$/, '');

/** 七牛批量操作单次上限 */
const BATCH_LIMIT = 1000;

function ready() {
    return !!(ACCESS_KEY && SECRET_KEY && BUCKET);
}

function uploader() {
    const mac = new qiniu.auth.digest.Mac(ACCESS_KEY, SECRET_KEY);
    // 不写死 zone，让 SDK 通过 uc 自动探测区域（与 backup-to-qiniu.js 一致），
    // 否则桶在亚太(up-as0)时会因区域不匹配返回 400。
    const config = new qiniu.conf.Config({ useHttpsDomain: false });
    return { formUploader: new qiniu.form_up.FormUploader(config), putExtra: new qiniu.form_up.PutExtra(), mac };
}

/** 管理端（删除/列举）用的 BucketManager */
function bucketManager() {
    const mac = new qiniu.auth.digest.Mac(ACCESS_KEY, SECRET_KEY);
    return new qiniu.rs.BucketManager(mac, new qiniu.conf.Config({ useHttpsDomain: false }));
}

/** 上传 Buffer 到七牛，返回 CDN URL */
function putBuffer(buffer, key, mime) {
    return new Promise((resolve, reject) => {
        if (!ready()) return reject(new Error('七牛云配置缺失'));
        const { formUploader, putExtra, mac } = uploader();
        const putPolicy = new qiniu.rs.PutPolicy({ scope: `${BUCKET}:${key}` });
        const token = putPolicy.uploadToken(mac);
        formUploader.put(token, key, buffer, putExtra, (err, body, info) => {
            if (err) return reject(err);
            if (info && info.statusCode === 200) return resolve(`${DOMAIN}/${key}`);
            reject(new Error('七牛上传失败: ' + (info && info.statusCode)));
        });
    });
}

/** 压缩图片（等比缩放 + 转 jpeg/webp） */
async function compressImage(buffer, maxSize = 1280, quality = 82) {
    try {
        const img = sharp(buffer, { failOn: 'none' }).rotate();
        const meta = await img.metadata();
        const resize = (meta.width && meta.width > maxSize) ? { width: maxSize } : {};
        return await img.resize(resize.width ? { width: maxSize } : undefined)
            .jpeg({ quality, mozjpeg: true })
            .toBuffer();
    } catch (e) {
        logger.warn('图片压缩失败，使用原图:', e.message);
        return buffer;
    }
}

/**
 * 上传聊天图片（压缩后）
 * @returns {Promise<string>} CDN URL
 */
async function uploadImage(buffer) {
    const compressed = await compressImage(buffer);
    const key = `chat/images/${Date.now()}_${crypto.randomBytes(6).toString('hex')}.jpg`;
    return putBuffer(compressed, key, 'image/jpeg');
}

/** 上传表情包（小图，压缩更狠，尽量保留透明→png） */
async function uploadSticker(buffer) {
    let out = buffer;
    let ext = 'png';
    try {
        const img = sharp(buffer, { failOn: 'none' }).rotate();
        const meta = await img.metadata();
        const hasAlpha = !!(meta.hasAlpha);
        const resized = img.resize({ width: 240, height: 240, fit: 'inside', withoutEnlargement: true });
        if (hasAlpha) {
            out = await resized.png({ compressionLevel: 9 }).toBuffer();
            ext = 'png';
        } else {
            out = await resized.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
            ext = 'jpg';
        }
    } catch (e) {
        logger.warn('表情包压缩失败，使用原图:', e.message);
    }
    const key = `chat/stickers/${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    return putBuffer(out, key, ext === 'png' ? 'image/png' : 'image/jpeg');
}

/** 上传语音（webm/ogg/m4a 等） */
async function uploadVoice(buffer, ext = 'webm') {
    const key = `chat/voices/${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const mime = ext === 'ogg' ? 'audio/ogg' : ext === 'm4a' ? 'audio/mp4' : 'audio/webm';
    return putBuffer(buffer, key, mime);
}

// ==================== 删除（节省对象存储空间） ====================

/**
 * CDN URL → 七牛对象 key。
 * 仅接受本站 CDN 域名的 URL，其它一律返回 null（避免误删外部资源）。
 * 传入的若已是纯 key，则原样返回。
 */
function keyFromUrl(url) {
    if (!url) return null;
    const s = String(url).trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, '') || null;
    try {
        const u = new URL(s);
        const dom = new URL(DOMAIN);
        if (u.host !== dom.host) return null;
        return decodeURIComponent(u.pathname.replace(/^\/+/, '')) || null;
    } catch {
        return null;
    }
}

/**
 * 删除单个对象。
 * @returns {Promise<boolean>} true=已删除或本就不存在
 */
function deleteObject(key) {
    return new Promise((resolve, reject) => {
        if (!ready()) return reject(new Error('七牛云配置缺失'));
        if (!key) return resolve(false);
        bucketManager().delete(BUCKET, key, (err, body, info) => {
            if (err) return reject(err);
            const code = info && info.statusCode;
            // 612 = 对象不存在，视为已达成删除目标
            if (code === 200 || code === 612) return resolve(true);
            reject(new Error('七牛删除失败: ' + code));
        });
    });
}

/**
 * 批量删除对象（自动按 1000 分批）。
 * @param {string[]} keys
 * @returns {Promise<{deleted:number, missing:number, failed:number}>}
 */
async function batchDelete(keys) {
    if (!ready()) throw new Error('七牛云配置缺失');
    const list = [...new Set((keys || []).filter(Boolean))];
    const out = { deleted: 0, missing: 0, failed: 0 };
    if (!list.length) return out;

    for (let i = 0; i < list.length; i += BATCH_LIMIT) {
        const slice = list.slice(i, i + BATCH_LIMIT);
        // eslint-disable-next-line no-await-in-loop
        const res = await new Promise((resolve, reject) => {
            const ops = slice.map((k) => qiniu.rs.deleteOp(BUCKET, k));
            bucketManager().batch(ops, (err, body) => {
                if (err) return reject(err);
                resolve(Array.isArray(body) ? body : []);
            });
        });
        if (!res.length) {
            // 未返回明细时保守计为成功（HTTP 层已成功）
            out.deleted += slice.length;
            continue;
        }
        res.forEach((r) => {
            const code = r && r.code;
            if (code === 200) out.deleted += 1;
            else if (code === 612) out.missing += 1;
            else out.failed += 1;
        });
    }
    return out;
}

/**
 * 按 CDN URL 批量删除（自动解析 key、跳过非本站地址）。
 * 永不抛错，失败只记录日志，避免影响主流程（如消息/表情包的数据库删除）。
 * @param {string[]} urls
 * @returns {Promise<{deleted:number, missing:number, failed:number, skipped:number}>}
 */
async function deleteByUrls(urls) {
    const out = { deleted: 0, missing: 0, failed: 0, skipped: 0 };
    const keys = [];
    (urls || []).forEach((u) => {
        const k = keyFromUrl(u);
        if (k) keys.push(k);
        else if (u) out.skipped += 1;
    });
    if (!keys.length) return out;
    try {
        const r = await batchDelete(keys);
        out.deleted = r.deleted;
        out.missing = r.missing;
        out.failed = r.failed;
    } catch (e) {
        out.failed += keys.length;
        logger.error('对象存储批量删除失败:', e.message);
    }
    return out;
}

/** 列举某前缀下的全部对象（分页拉全），供运维脚本统计/回收孤儿使用 */
function listPrefixAll(prefix) {
    return new Promise((resolve, reject) => {
        if (!ready()) return reject(new Error('七牛云配置缺失'));
        const bm = bucketManager();
        let all = [];
        let marker = '';
        const page = () => {
            bm.listPrefix(BUCKET, { prefix, limit: 1000, marker: marker || '' }, (err, body, info) => {
                if (err) return reject(err);
                if (!info || info.statusCode !== 200) return reject(new Error('七牛列举失败: ' + (info && info.statusCode)));
                all = all.concat(body.items || []);
                marker = body.marker || '';
                if (marker) page();
                else resolve(all);
            });
        };
        page();
    });
}

module.exports = {
    ready, uploadImage, uploadSticker, uploadVoice, compressImage,
    keyFromUrl, deleteObject, batchDelete, deleteByUrls, listPrefixAll,
    BUCKET, DOMAIN,
};
