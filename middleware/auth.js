const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');
const db = require('../database');

if (!process.env.JWT_SECRET) {
    logger.error('错误: 未配置 JWT_SECRET 环境变量，请在 .env 文件中设置');
    process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;

// 验证JWT令牌
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: '未提供认证令牌' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userLevel = decoded.level;
        next();
    } catch (error) {
        return res.status(401).json({ error: '无效的认证令牌' });
    }
};

// 实时获取用户最新 level（避免 token 快照过时：提升权限后无需重新登录）
async function fetchLatestLevel(userId) {
    try {
        const user = await db.get('SELECT level FROM users WHERE id = ?', [userId]);
        return user ? user.level : -1;
    } catch (e) {
        logger.error('查询用户等级错误:', e.message);
        return -1;
    }
}

// 验证管理员权限（实时读取数据库 level >= 1）
const adminMiddleware = async (req, res, next) => {
    const level = await fetchLatestLevel(req.userId);
    if (level < 1) {
        return res.status(403).json({ error: '权限不足，需要管理员权限' });
    }
    req.userLevel = level;
    next();
};

// 验证超级管理员权限（实时读取数据库 level >= 2）
const superAdminMiddleware = async (req, res, next) => {
    const level = await fetchLatestLevel(req.userId);
    if (level < 2) {
        return res.status(403).json({ error: '权限不足，需要超级管理员权限' });
    }
    req.userLevel = level;
    next();
};

module.exports = {
    authMiddleware,
    adminMiddleware,
    superAdminMiddleware,
    fetchLatestLevel,
    JWT_SECRET
};
