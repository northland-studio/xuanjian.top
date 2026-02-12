const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

// 尝试加载 sharp（图片压缩库）
let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    console.log('sharp 未安装，图片压缩功能不可用');
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

// 压缩图片函数
async function compressImage(inputPath, outputPath, maxWidth = 1920, quality = 80) {
    if (!sharp) return false;
    
    try {
        await sharp(inputPath)
            .resize(maxWidth, null, { withoutEnlargement: true })
            .jpeg({ quality, progressive: true })
            .toFile(outputPath + '.tmp');
        
        // 替换原文件
        fs.unlinkSync(inputPath);
        fs.renameSync(outputPath + '.tmp', outputPath);
        
        return true;
    } catch (error) {
        console.error('压缩失败:', error);
        return false;
    }
}

// 上传图片
router.post('/image', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '没有上传文件' });
        }
        
        const filePath = path.join(uploadsDir, req.file.filename);
        
        // 压缩图片（如果是图片且 sharp 可用）
        if (sharp && req.file.mimetype.startsWith('image/')) {
            const compressed = await compressImage(filePath, filePath);
            if (compressed) {
                // 获取压缩后的大小
                const stats = fs.statSync(filePath);
                console.log(`图片已压缩: ${req.file.originalname} -> ${(stats.size / 1024).toFixed(2)}KB`);
            }
        }
        
        const imageUrl = `/uploads/${req.file.filename}`;
        
        res.json({
            message: '上传成功',
            url: imageUrl,
            filename: req.file.filename
        });
    } catch (error) {
        console.error('上传错误:', error);
        res.status(500).json({ error: '上传失败' });
    }
});

// 上传多张图片
router.post('/images', authMiddleware, upload.array('images', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '没有上传文件' });
        }
        
        const urls = req.files.map(file => `/uploads/${file.filename}`);
        
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
