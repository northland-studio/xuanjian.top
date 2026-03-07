const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { sendVerificationCode } = require('../config/mail');
const router = express.Router();

// 生成6位验证码
function generateCode() {
    return Math.random().toString().slice(2, 8);
}

// 发送验证码
router.post('/send-code', async (req, res) => {
    try {
        const { email, type = 'register' } = req.body;
        
        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '邮箱格式不正确' });
        }
        
        // 检查邮箱是否已被注册（注册时）
        if (type === 'register') {
            const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
            if (existingEmail) {
                return res.status(400).json({ error: '邮箱已被注册' });
            }
        }
        
        // 检查发送频率（60秒内不能重复发送）
        const recentCode = await db.get(
            'SELECT * FROM verification_codes WHERE email = ? AND type = ? AND created_at > datetime("now", "-60 seconds")',
            [email, type]
        );
        if (recentCode) {
            return res.status(429).json({ error: '发送过于频繁，请稍后再试' });
        }
        
        // 生成验证码
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10分钟过期
        
        // 保存验证码到数据库
        await db.run(
            'INSERT INTO verification_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)',
            [email, code, type, expiresAt.toISOString()]
        );
        
        // 发送邮件
        await sendVerificationCode(email, code);
        
        res.json({ message: '验证码已发送' });
    } catch (error) {
        console.error('发送验证码错误:', error);
        res.status(500).json({ error: '发送验证码失败' });
    }
});

// 验证验证码
async function verifyCode(email, code, type) {
    const record = await db.get(
        'SELECT * FROM verification_codes WHERE email = ? AND code = ? AND type = ? AND used = 0 AND expires_at > datetime("now")',
        [email, code, type]
    );
    if (record) {
        await db.run('UPDATE verification_codes SET used = 1 WHERE id = ?', [record.id]);
        return true;
    }
    return false;
}

// 用户注册
router.post('/register', async (req, res) => {
    try {
        const { username, nickname, email, password, verificationCode } = req.body;

        // 验证输入
        if (!username || !nickname || !email || !password || !verificationCode) {
            return res.status(400).json({ error: '请填写所有必填字段，包括验证码' });
        }

        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '邮箱格式不正确' });
        }

        // 验证验证码
        const isCodeValid = await verifyCode(email, verificationCode, 'register');
        if (!isCodeValid) {
            return res.status(400).json({ error: '验证码无效或已过期' });
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

        // 创建用户（邮箱已验证）
        const result = await db.run(
            'INSERT INTO users (username, nickname, email, password, email_verified) VALUES (?, ?, ?, ?, ?)',
            [username, nickname, email, hashedPassword, 1]
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
            'SELECT id, username, nickname, email, password, level, contribution, avatar, email_verified FROM users WHERE username = ?',
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
            'SELECT id, username, nickname, email, level, contribution, avatar, email_verified, created_at FROM users WHERE id = ?',
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
        const { nickname, email, avatar, currentPassword, newPassword } = req.body;
        
        // 如果要修改密码
        if (newPassword) {
            const user = await db.get('SELECT password FROM users WHERE id = ?', [req.userId]);
            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return res.status(400).json({ error: '当前密码错误' });
            }
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await db.run(
                'UPDATE users SET nickname = ?, email = ?, avatar = ?, password = ?, updated_at = ? WHERE id = ?',
                [nickname, email, avatar, hashedPassword, getLocalTimestamp(), req.userId]
            );
        } else {
            await db.run(
                'UPDATE users SET nickname = ?, email = ?, avatar = ?, updated_at = ? WHERE id = ?',
                [nickname, email, avatar, getLocalTimestamp(), req.userId]
            );
        }
        
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
            'UPDATE users SET password = ?, updated_at = ? WHERE id = ?',
            [hashedPassword, getLocalTimestamp(), req.userId]
        );

        res.json({ message: '密码修改成功' });
    } catch (error) {
        console.error('修改密码错误:', error);
        res.status(500).json({ error: '修改密码失败' });
    }
});

// 发送邮箱绑定验证码
router.post('/send-bind-code', authMiddleware, async (req, res) => {
    try {
        const { email } = req.body;

        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '邮箱格式不正确' });
        }

        // 检查邮箱是否已被其他用户使用
        const existingEmail = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.userId]);
        if (existingEmail) {
            return res.status(400).json({ error: '邮箱已被其他用户使用' });
        }

        // 检查发送频率
        const recentCode = await db.get(
            'SELECT * FROM verification_codes WHERE email = ? AND type = ? AND created_at > datetime("now", "-60 seconds")',
            [email, 'bind']
        );
        if (recentCode) {
            return res.status(429).json({ error: '发送过于频繁，请稍后再试' });
        }

        // 生成验证码
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // 保存验证码
        await db.run(
            'INSERT INTO verification_codes (email, code, type, expires_at) VALUES (?, ?, ?, ?)',
            [email, code, 'bind', expiresAt.toISOString()]
        );

        // 发送邮件
        await sendVerificationCode(email, code);

        res.json({ message: '验证码已发送' });
    } catch (error) {
        console.error('发送绑定验证码错误:', error);
        res.status(500).json({ error: '发送验证码失败' });
    }
});

// 绑定/验证邮箱
router.post('/verify-email', authMiddleware, async (req, res) => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ error: '请提供邮箱和验证码' });
        }

        // 验证验证码
        const isCodeValid = await verifyCode(email, code, 'bind');
        if (!isCodeValid) {
            return res.status(400).json({ error: '验证码无效或已过期' });
        }

        // 检查邮箱是否已被其他用户使用
        const existingEmail = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.userId]);
        if (existingEmail) {
            return res.status(400).json({ error: '邮箱已被其他用户使用' });
        }

        // 更新用户邮箱验证状态
        await db.run(
            'UPDATE users SET email = ?, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [email, req.userId]
        );

        res.json({ message: '邮箱验证成功' });
    } catch (error) {
        console.error('验证邮箱错误:', error);
        res.status(500).json({ error: '验证邮箱失败' });
    }
});

// 通过用户名获取用户信息（公开接口）
router.get('/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        const user = await db.get(
            `SELECT u.id, u.username, u.nickname, u.email, u.avatar, u.level, u.contribution, u.created_at,
                    t.name as title_name, t.color as title_color
             FROM users u
             LEFT JOIN titles t ON u.equipped_title = t.id
             WHERE u.username = ?`,
            [username]
        );
        
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        
        // 获取用户帖子数
        const postCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE author_id = ? AND status = "active"', [user.id]);
        
        // 获取用户评论数
        const commentCount = await db.get('SELECT COUNT(*) as count FROM comments WHERE author_id = ? AND status = "active"', [user.id]);
        
        // 获取用户获赞数（所有帖子的点赞总和）
        const likesCount = await db.get(
            'SELECT SUM(CAST(likes AS INTEGER)) as total FROM posts WHERE author_id = ? AND status = "active"',
            [user.id]
        );
        
        res.json({
            user: {
                ...user,
                posts_count: postCount.count || 0,
                comments_count: commentCount.count || 0,
                likes_count: likesCount.total || 0
            }
        });
    } catch (error) {
        console.error('获取用户信息错误:', error);
        res.status(500).json({ error: '获取用户信息失败' });
    }
});

module.exports = router;
