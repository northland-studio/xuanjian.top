/**
 * 捐赠墙材料 / 收款码上传
 *  - 材料：图片（png/jpg/webp/gif，服务端压缩到最长边 1600）或 PDF（原样上传）
 *  - 收款码：图片
 * 统一存七牛公开 CDN；返回可直接展示/下载的 URL。
 */
const qiniu = require('qiniu');
const sharp = require('sharp');
const crypto = require('crypto');
const logger = require('./logger');

const ACCESS_KEY = process.env.QINIU_ACCESS_KEY || '';
const SECRET_KEY = process.env.QINIU_SECRET_KEY || '';
const BUCKET = process.env.QINIU_BUCKET || 'xuanjian-top';
const DOMAIN = (process.env.QINIU_DOMAIN || 'https://cdn.xuanjian.top').replace(/\/$/, '');

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
const PDF_MIME = 'application/pdf';

function ready() {
    return !!(ACCESS_KEY && SECRET_KEY && BUCKET);
}

/**
 * 构造七牛上传器。
 * ⚠️ 函数名不要叫 formUploader：下面 putBuffer 里会 `const { formUploader } = uploader()`，
 * 同名会导致局部 const 遮蔽外层函数，右侧调用命中 TDZ 报
 * "Cannot access 'formUploader' before initialization"。
 */
function uploader() {
    const mac = new qiniu.auth.digest.Mac(ACCESS_KEY, SECRET_KEY);
    const config = new qiniu.conf.Config({ useHttpsDomain: false });
    return { formUploader: new qiniu.form_up.FormUploader(config), putExtra: new qiniu.form_up.PutExtra(), mac };
}

function putBuffer(buffer, key) {
    return new Promise((resolve, reject) => {
        if (!ready()) return reject(new Error('对象存储未配置'));
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

/** 判断文件类型是否受支持 */
function classify(mimetype, filename = '') {
    const mt = String(mimetype || '').toLowerCase();
    if (mt === PDF_MIME || /\.pdf$/i.test(filename)) return 'pdf';
    if (IMAGE_MIMES.includes(mt)) return 'image';
    return null;
}

/** 扩展名（用于 key 后缀；优先按 mimetype，其次原文件名） */
function extOf(mimetype, filename = '') {
    const nameExt = (String(filename).match(/\.([A-Za-z0-9]{2,5})$/) || [])[1];
    const map = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
        'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf',
    };
    return map[String(mimetype || '').toLowerCase()] || (nameExt ? nameExt.toLowerCase() : 'bin');
}

/**
 * 上传一份材料
 * @param {{buffer:Buffer, mimetype:string, originalname:string, size:number}} file
 * @returns {Promise<{url,name,size,type,ext}>}
 */
async function uploadMaterial(file) {
    const kind = classify(file.mimetype, file.originalname);
    if (!kind) throw new Error('仅支持图片（png/jpg/webp/gif）与 PDF');

    const ext = extOf(file.mimetype, file.originalname);
    let body = file.buffer;

    if (kind === 'image') {
        // gif 保留动画，不压缩；其余图片压缩到最长边 1600
        if (ext !== 'gif') {
            try {
                body = await sharp(file.buffer, { failOn: 'none' })
                    .rotate()
                    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85, mozjpeg: true })
                    .toBuffer();
            } catch (e) {
                logger.warn('捐赠材料图片压缩失败，使用原图:', e.message);
                body = file.buffer;
            }
        }
    }

    const key = `donation/materials/${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const url = await putBuffer(body, key);
    return {
        url,
        name: String(file.originalname || 'material').slice(0, 120),
        size: body.length,
        type: kind,
        ext,
    };
}

/** 上传收款码 */
async function uploadQr(file) {
    const kind = classify(file.mimetype, file.originalname);
    if (kind !== 'image') throw new Error('收款码必须是图片');
    let body = file.buffer;
    try {
        body = await sharp(file.buffer, { failOn: 'none' })
            .rotate()
            .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
            .png({ compressionLevel: 9 })
            .toBuffer();
    } catch (e) {
        logger.warn('收款码压缩失败，使用原图:', e.message);
        body = file.buffer;
    }
    const key = `donation/qr/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
    return putBuffer(body, key);
}

module.exports = { ready, uploadMaterial, uploadQr, classify, IMAGE_MIMES, PDF_MIME };
