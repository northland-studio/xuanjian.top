const express = require('express');
const logger = require('../lib/logger');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const qiniuSdk = require('qiniu');
const { authMiddleware } = require('../middleware/auth');
const qiniu = require('../lib/qiniu');
const router = express.Router();

// 水印图片路径
const watermarkPath = path.join(__dirname, '..', 'public', 'images', 'watermark.png');

// 添加水印函数
async function addWatermark(inputPath) {
    // 如果水印文件不存在，直接返回原图
    if (!fs.existsSync(watermarkPath)) {
        return inputPath;
    }
    
    // 获取原图信息
    const metadata = await sharp(inputPath).metadata();
    
    // 计算水印大小（原图宽度的1%）
    const watermarkWidth = Math.round(metadata.width * 0.01);
    
    // 添加水印到右下角
    const outputPath = inputPath.replace(/(\.\w+)$/, '_watermarked$1');
    await sharp(inputPath)
        .composite([{
            input: watermarkPath,
            width: watermarkWidth,
            gravity: 'southeast',
            blend: 'over'
        }])
        .toFile(outputPath);
    
    // 删除原图，返回水印后的图片路径
    fs.unlinkSync(inputPath);
    return outputPath;
}

// 确保上传目录存在
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// 配置存储
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

// 文件过滤
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('不支持的文件类型，仅支持 JPG, PNG, GIF, WEBP'), false);
    }
};

// 配置上传
const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});

// ============ 直传凭证（对齐 MCVCBA）============
const EXT_WHITELIST = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'litematic']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/** 上传类型 → 存储目录 + 允许的扩展名 */
const KINDS = {
    wiki: { dir: 'wiki', exts: EXT_WHITELIST },
    post: { dir: 'posts', exts: EXT_WHITELIST },
    avatar: { dir: 'avatars', exts: IMAGE_EXTS },
    image: { dir: 'images', exts: IMAGE_EXTS },
    screenshot: { dir: 'screenshots', exts: IMAGE_EXTS },
    market: { dir: 'market', exts: IMAGE_EXTS },
    banner: { dir: 'banners', exts: IMAGE_EXTS },
    projection: { dir: 'projections', exts: new Set(['litematic']) }
};

const KEY_DIRS = [...new Set(Object.values(KINDS).map((k) => k.dir))];
const KEY_PREFIX_RE = new RegExp('^(' + KEY_DIRS.join('|') + ')/(\\d+)/');

function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || '').split('?')[0].split('#')[0]);
    return m ? m[1].toLowerCase() : '';
}

function maxSizeMB(kind, ext) {
    if (kind === 'avatar') return 2;
    if (kind === 'projection') return 20;
    if (IMAGE_EXTS.has(ext)) return 5;
    return 20;
}

/**
 * 生成七牛直传凭证（前端 XHR 直传，带进度回调）
 * body: { kind, filename }
 */
router.post('/token', authMiddleware, (req, res) => {
    try {
        const body = req.body || {};
        const kind = String(body.kind || 'image').trim();
        const meta = KINDS[kind];
        if (!meta) return res.status(400).json({ error: '不支持的上传类型：' + kind });

        const filename = String(body.filename || '').trim();
        if (!filename) return res.status(400).json({ error: '缺少文件名' });
        if (filename.length > 200) return res.status(400).json({ error: '文件名过长' });

        const ext = extOf(filename);
        if (!ext || !EXT_WHITELIST.has(ext)) {
            return res.status(400).json({ error: '不支持的文件格式：' + (ext ? '.' + ext : '未知') + '，支持 ' + [...EXT_WHITELIST].join('/') });
        }
        if (!meta.exts.has(ext)) {
            return res.status(400).json({ error: '类型 ' + kind + ' 只允许上传：' + [...meta.exts].join('/') });
        }

        const limit = maxSizeMB(kind, ext);
        const key = meta.dir + '/' + req.userId + '/' + Date.now() + '-' + uuidv4().slice(0, 8) + '.' + ext;
        const uploadToken = qiniu.generateUploadToken(key, limit * 1024 * 1024);

        res.json({
            uploadToken,
            token: uploadToken,
            key,
            url: qiniu.QINIU_DOMAIN + '/' + key,
            domain: qiniu.QINIU_DOMAIN,
            uploadUrl: qiniu.QINIU_UPLOAD_URL,
            kind,
            maxSizeMB: limit
        });
    } catch (error) {
        logger.error('生成上传凭证错误:', error);
        res.status(500).json({ error: error.message || '生成上传凭证失败' });
    }
});

/**
 * 删除已上传对象（仅自己目录；管理员可删任意合法前缀）
 * body: { key }
 */
router.delete('/object', authMiddleware, async (req, res) => {
    try {
        const key = String((req.body && req.body.key) || '').trim();
        if (!key) return res.status(400).json({ error: '缺少对象 Key' });
        if (key.includes('..') || key.startsWith('/')) return res.status(403).json({ error: '非法的对象 Key' });

        const m = KEY_PREFIX_RE.exec(key);
        if (!m) return res.status(403).json({ error: '对象 Key 前缀不合法' });

        const ownerId = Number(m[2]);
        const level = Number(req.userLevel || req.user?.level || 0);
        if (level < 1 && ownerId !== Number(req.userId)) {
            return res.status(403).json({ error: '只能删除自己上传的文件' });
        }

        const ok = await new Promise((resolve) => {
            const mac = new qiniuSdk.auth.digest.Mac(process.env.QINIU_ACCESS_KEY || '', process.env.QINIU_SECRET_KEY || '');
            const cfg = new qiniuSdk.conf.Config();
            cfg.zone = qiniuSdk.zone.Zone_as0;
            const bm = new qiniuSdk.rs.BucketManager(mac, cfg);
            bm.delete(qiniu.QINIU_BUCKET || 'xuanjian-top', key, (err, body, info) => {
                resolve(!err && info.statusCode === 200);
            });
        });
        res.json({ ok, key });
    } catch (e) {
        logger.error('删除七牛对象失败:', e);
        res.status(500).json({ error: '删除失败' });
    }
});

// 生成投影文件（.litematic）上传凭证（前端 XHR 直传，最大 20MB）
router.post('/projection-token', authMiddleware, (req, res) => {
    try {
        const originalname = (req.body && req.body.filename) || '';
        const ext = path.extname(originalname).toLowerCase();
        if (ext !== '.litematic') {
            return res.status(400).json({ error: '仅支持 .litematic 投影文件' });
        }
        const key = `projections/${uuidv4()}.litematic`;
        const uploadToken = qiniu.generateUploadToken(key, 20 * 1024 * 1024);
        res.json({
            uploadToken,
            key,
            domain: qiniu.QINIU_DOMAIN,
            uploadUrl: qiniu.QINIU_UPLOAD_URL
        });
    } catch (error) {
        logger.error('生成投影上传凭证错误:', error);
        res.status(500).json({ error: error.message || '生成上传凭证失败' });
    }
});

// 上传图片
router.post('/image', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '没有上传文件' });
        }
        
        // 添加水印
        const filePath = path.join(uploadsDir, req.file.filename);
        const watermarkedPath = await addWatermark(filePath);
        const filename = path.basename(watermarkedPath);
        const imageUrl = `/uploads/${filename}`;
        
        res.json({
            message: '上传成功',
            url: imageUrl,
            filename: filename
        });
    } catch (error) {
        logger.error('上传错误:', error);
        res.status(500).json({ error: '上传失败' });
    }
});

// 上传多张图片
router.post('/images', authMiddleware, upload.array('images', 10), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '没有上传文件' });
        }
        
        // 为每张图片添加水印
        const urls = [];
        for (const file of req.files) {
            const filePath = path.join(uploadsDir, file.filename);
            const watermarkedPath = await addWatermark(filePath);
            const filename = path.basename(watermarkedPath);
            urls.push(`/uploads/${filename}`);
        }
        
        res.json({
            message: '上传成功',
            urls
        });
    } catch (error) {
        logger.error('上传错误:', error);
        res.status(500).json({ error: '上传失败' });
    }
});

// 错误处理
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '文件大小超过限制（最大5MB）' });
        }
    }
    res.status(500).json({ error: error.message || '上传失败' });
});

module.exports = router;
