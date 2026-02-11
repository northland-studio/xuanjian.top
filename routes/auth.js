const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const router = express.Router();

// 用户注册
router.post('/register', async (req, res) => {
    try {
        const { username, nickname, email, password } = req.body;
        
        // 验证输入
        if (!username || !nickname || !email || !password) {
            return res.status(400).json({ error: '请填写所有必填字段' });
        }
        
        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '邮箱格式不正确' });
        }
        
        // 检查用户名是否已存在
        const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUser) {
            return res.status(400).json({ error: '用户名已被使用' });
        }
        
        // 检查邮箱是否已存在
        const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail) {
            return res.status(400).json({ error: '邮箱已被注册' });
        }
        
        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // 创建用户
        const result = await db.run(
            'INSERT INTO users (username, nickname, email, password) VALUES (?, ?, ?, ?)',
            [username, nickname, email, hashedPassword]
        );
        
        res.status(201).json({ 
            message: '注册成功',
            userId: result.id
        });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

// 用户登录
router.post('/login', async (req, res) => {
    try {
        const { username, password, remember } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '请填写用户名和密码' });
        }
        
        // 查找用户
        const user = await db.get(
            'SELECT id, username, nickname, email, password, level, contribution, avatar FROM users WHERE username = ?',
            [username]
        );
        
        if (!user) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        
        // 验证密码
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        
        // 生成JWT令牌
        const expiresIn = remember ? '30d' : '24h';
        const token = jwt.sign(
            { userId: user.id, username: user.username, level: user.level },
            JWT_SECRET,
            { expiresIn }
        );
        
        // 删除密码字段
        delete user.password;
        
        res.json({
            message: '登录成功',
            token,
            user
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// 获取当前用户信息
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, username, nickname, email, level, contribution, avatar, created_at FROM users WHERE id = ?',
            [req.userId]
        );
        
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        
        res.json(user);
    } catch (error) {
        console.error('获取用户信息错误:', error);
        res.status(500).json({ error: '获取用户信息失败' });
    }
});

// 更新用户信息
router.put('/profile', authMiddleware, async (req, res) => {
    try {
        const { nickname, email, avatar } = req.body;
        
        await db.run(
            'UPDATE users SET nickname = ?, email = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [nickname, email, avatar, req.userId]
        );
        
        res.json({ message: '用户信息更新成功' });
    } catch (error) {
        console.error('更新用户信息错误:', error);
        res.status(500).json({ error: '更新用户信息失败' });
    }
});

// 修改密码
router.put('/password', authMiddleware, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        
        // 获取用户当前密码
        const user = await db.get('SELECT password FROM users WHERE id = ?', [req.userId]);
        
        // 验证旧密码
        const isValid = await bcrypt.compare(oldPassword, user.password);
        if (!isValid) {
            return res.status(400).json({ error: '原密码错误' });
        }
        
        // 加密新密码
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await db.run(
            'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedPassword, req.userId]
        );
        
        res.json({ message: '密码修改成功' });
    } catch (error) {
        console.error('修改密码错误:', error);
        res.status(500).json({ error: '修改密码失败' });
    }
});

module.exports = router;
