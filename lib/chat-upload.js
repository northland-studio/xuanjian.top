/**
 * 聊天媒体上传工具
 *  - 图片：用 sharp 压缩（限制尺寸/质量）后直传七牛
 *  - 语音：原样直传七牛（webm/ogg，限制时长由前端控制 ≤60s）
 * 全部返回 CDN 公开 URL。
 */
const qiniu = require('qiniu');
const sharp = require('sharp');
const crypto = require('crypto');
const logger = require('./logger');

const ACCESS_KEY = process.env.QINIU_ACCESS_KEY || '';
const SECRET_KEY = process.env.QINIU_SECRET_KEY || '';
const BUCKET = process.env.QINIU_BUCKET || 'xuanjian-top';
const DOMAIN = (process.env.QINIU_DOMAIN || 'https://cdn.xuanjian.top').replace(/\/$/, '');

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

module.exports = { ready, uploadImage, uploadSticker, uploadVoice, compressImage };
