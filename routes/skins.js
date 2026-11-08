// 皮肤模块：上传 Minecraft 皮肤（64x64 PNG）、随机皮肤池、用户皮肤
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// 皮肤上传目录（复用 /uploads 静态服务）
const skinDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(skinDir)) {
    fs.mkdirSync(skinDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, skinDir),
    filename: (req, file, cb) => cb(null, `skin-${uuidv4()}.png`)
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        // 皮肤必须是 PNG
        if (file.mimetype === 'image/png' || file.mimetype === 'image/x-png') {
            cb(null, true);
        } else {
            cb(new Error('皮肤文件必须为 PNG 格式'), false);
        }
    },
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// 上传自己的皮肤
router.post('/', authMiddleware, upload.single('skin'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '没有上传文件' });
        }

        const filePath = path.join(skinDir, req.file.filename);

        // 校验必须是 64x64 的 Minecraft 皮肤
        const meta = await sharp(filePath).metadata();
        if (meta.width !== 64 || meta.height !== 64) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: '皮肤尺寸必须为 64×64 像素' });
        }

        // 确认是 PNG（magic bytes 校验）
        const buf = fs.readFileSync(filePath);
        if (!buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ error: '皮肤文件必须为 PNG 格式' });
        }

        const skinPath = `/uploads/${req.file.filename}`;

        // 游戏ID（皮肤上传框旁的输入框，留空则显示用户名）
        const gameId = String(req.body.gameId || '').trim().slice(0, 24);

        // 删除旧的皮肤文件（如果有）
        const me = await db.get('SELECT skin_path FROM users WHERE id = ?', [req.userId]);
        const oldSkin = me && me.skin_path ? me.skin_path : '';
        if (oldSkin && oldSkin.startsWith('/uploads/')) {
            const oldPath = path.join(skinDir, path.basename(oldSkin));
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        // 写入数据库
        await db.run(
            'UPDATE users SET skin_path = ?, game_id = ?, updated_at = ? WHERE id = ?',
            [skinPath, gameId, getLocalTimestamp(), req.userId]
        );

        res.json({ message: '皮肤上传成功', skin: skinPath });
    } catch (error) {
        logger.error('上传皮肤错误:', error);
        res.status(500).json({ error: '皮肤上传失败' });
    }
});

// 移除自己的皮肤（清空 skin_path 并删除文件）
router.delete('/', authMiddleware, async (req, res) => {
    try {
        const me = await db.get('SELECT skin_path FROM users WHERE id = ?', [req.userId]);
        if (!me || !me.skin_path) {
            return res.json({ message: '当前没有皮肤' });
        }

        if (me.skin_path.startsWith('/uploads/')) {
            const oldPath = path.join(skinDir, path.basename(me.skin_path));
            if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
            }
        }

        await db.run(
            'UPDATE users SET skin_path = NULL, updated_at = ? WHERE id = ?',
            [getLocalTimestamp(), req.userId]
        );

        res.json({ message: '皮肤已移除', skin: null });
    } catch (error) {
        logger.error('移除皮肤错误:', error);
        res.status(500).json({ error: '移除皮肤失败' });
    }
});

// 随机皮肤池：返回一个随机用户的皮肤及其名字（游戏ID 留空时用用户名）
router.get('/random', async (req, res) => {
    try {
        const row = await db.get(
            `SELECT skin_path, COALESCE(NULLIF(game_id, ''), username) AS name FROM users
             WHERE skin_path IS NOT NULL AND skin_path != ''
             ORDER BY RANDOM() LIMIT 1`
        );
        res.json({ skin: row ? row.skin_path : null, name: row ? row.name : null });
    } catch (error) {
        logger.error('获取随机皮肤错误:', error);
        res.status(500).json({ error: '获取随机皮肤失败' });
    }
});

// 按游戏 ID / 用户名查询成员皮肤（公开只读，供 XBed 等站内应用生成海报）
// 限流按 gameId 计数：XBed 服务端代理调用时所有请求同源 IP，按 IP 限流会误伤
const lookupLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.query.gameId || req.query.name || req.ip),
    message: { skin: null, exists: false, error: 'rate_limited' }
});

// 兜底：同 IP 总量限制（防止有人用随机 gameId 绕过 per-key 限流）
const lookupIpGuard = rateLimit({
    windowMs: 60 * 1000,
    max: 1200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { skin: null, exists: false, error: 'rate_limited' }
});

router.get('/lookup', lookupIpGuard, lookupLimiter, async (req, res) => {
    try {
        const keyword = String(req.query.gameId || req.query.name || '').trim().slice(0, 32);
        if (!keyword) {
            return res.status(400).json({ skin: null, exists: false, error: 'missing_gameId' });
        }

        // 优先匹配 game_id，其次匹配 username；只返回已上传皮肤的用户
        const row = await db.get(
            `SELECT u.skin_path, u.username, COALESCE(NULLIF(u.game_id, ''), u.username) AS name
               FROM users u
              WHERE u.skin_path IS NOT NULL AND u.skin_path <> ''
                AND (LOWER(COALESCE(u.game_id, '')) = LOWER(?)
                  OR LOWER(COALESCE(u.username, '')) = LOWER(?))
              ORDER BY CASE WHEN LOWER(COALESCE(u.game_id, '')) = LOWER(?) THEN 0 ELSE 1 END
              LIMIT 1`,
            [keyword, keyword, keyword]
        );

        if (row) {
            res.set('Cache-Control', 'public, max-age=300');
            return res.json({
                skin: row.skin_path,       // 形如 /uploads/skin-xxxx.png
                gameId: row.name,
                username: row.username,
                exists: true
            });
        }

        // 没皮肤：区分「用户存在但未上传皮肤」与「查无此人」
        const existsRow = await db.get(
            `SELECT 1 AS hit FROM users
              WHERE LOWER(COALESCE(game_id, '')) = LOWER(?)
                 OR LOWER(COALESCE(username, '')) = LOWER(?)
              LIMIT 1`,
            [keyword, keyword]
        );
        res.set('Cache-Control', 'public, max-age=60');
        res.json({
            skin: null,
            gameId: keyword,
            username: null,
            exists: !!existsRow
        });
    } catch (error) {
        logger.error('查询皮肤错误:', error);
        res.status(500).json({ skin: null, exists: false, error: 'lookup_failed' });
    }
});

// 上传错误处理
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '文件大小超过限制（最大2MB）' });
        }
    }
    res.status(400).json({ error: error.message || '上传失败' });
});

module.exports = router;
