const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';

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

// 验证管理员权限（level >= 1）
const adminMiddleware = (req, res, next) => {
    if (req.userLevel < 1) {
        return res.status(403).json({ error: '权限不足，需要管理员权限' });
    }
    next();
};

// 验证超级管理员权限（level >= 2）
const superAdminMiddleware = (req, res, next) => {
    if (req.userLevel < 2) {
        return res.status(403).json({ error: '权限不足，需要超级管理员权限' });
    }
    next();
};

module.exports = {
    authMiddleware,
    adminMiddleware,
    superAdminMiddleware,
    JWT_SECRET
};
