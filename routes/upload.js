const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
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
    
    // 计算水印大小（原图宽度的2%）
    const watermarkWidth = Math.round(metadata.width * 0.02);
    
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
        console.error('上传错误:', error);
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
        console.error('上传错误:', error);
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
