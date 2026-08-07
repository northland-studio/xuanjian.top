const express = require('express');
const logger = require('../lib/logger');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { sendVerificationCode } = require('../config/mail');
const router = express.Router();

// 生成6位验证码
function generateCode() {
    return crypto.randomInt(100000, 999999).toString();
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
        logger.error('发送验证码错误:', error);
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

// 用户注册（已关闭：新用户必须通过QQ登录注册）
router.post('/register', async (req, res) => {
    return res.status(403).json({ error: '新用户注册仅支持QQ登录，请使用QQ登录' });
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
            'SELECT id, username, nickname, email, password, level, contribution, avatar, email_verified, password_set FROM users WHERE username = ?',
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
        logger.error('登录错误:', error);
        res.status(500).json({ error: '登录失败，请稍后重试' });
    }
});

// 获取当前用户信息
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, username, nickname, email, level, contribution, avatar, cover, email_verified, openid, password_set, skin_path, created_at FROM users WHERE id = ?',
            [req.userId]
        );

        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 实时统计：发帖 / 评论 / 获赞
        const postCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE author_id = ? AND status = "active"', [req.userId]);
        const commentCount = await db.get('SELECT COUNT(*) as count FROM comments WHERE author_id = ? AND status = "active"', [req.userId]);
        const likesCount = await db.get(
            'SELECT SUM(CAST(likes AS INTEGER)) as total FROM posts WHERE author_id = ? AND status = "active"',
            [req.userId]
        );
        user.posts_count = postCount.count || 0;
        user.comments_count = commentCount.count || 0;
        user.likes_count = likesCount.total || 0;

        // 补充绑定状态字段
        user.qq_bound = !!(user.openid && user.openid !== '');
        user.email_bound = !!(user.email && user.email.trim() !== '');
        delete user.openid;

        res.json(user);
    } catch (error) {
        logger.error('获取用户信息错误:', error);
        res.status(500).json({ error: '获取用户信息失败' });
    }
});

// 更新用户信息（昵称/头像/封面）
router.put('/profile', authMiddleware, async (req, res) => {
    try {
        const { nickname, email, avatar, cover, currentPassword, newPassword } = req.body;
        
        // 如果要修改/设置密码
        if (newPassword) {
            const user = await db.get('SELECT password, password_set FROM users WHERE id = ?', [req.userId]);
            // 已设置过密码的用户需验证当前密码；未设置密码（QQ注册）直接设置
            if (user.password_set === 1) {
                const isValid = await bcrypt.compare(currentPassword, user.password);
                if (!isValid) {
                    return res.status(400).json({ error: '当前密码错误' });
                }
            }
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await db.run(
                'UPDATE users SET nickname = ?, email = ?, avatar = ?, cover = ?, password = ?, password_set = 1, updated_at = ? WHERE id = ?',
                [nickname, email, avatar, cover || '', hashedPassword, getLocalTimestamp(), req.userId]
            );
        } else {
            await db.run(
                'UPDATE users SET nickname = ?, email = ?, avatar = ?, cover = ?, updated_at = ? WHERE id = ?',
                [nickname, email, avatar, cover || '', getLocalTimestamp(), req.userId]
            );
        }
        
        res.json({ message: '用户信息更新成功' });
    } catch (error) {
        logger.error('更新用户信息错误:', error);
        res.status(500).json({ error: '更新用户信息失败' });
    }
});

// 修改自定义ID（用户名）
router.put('/username', authMiddleware, async (req, res) => {
    try {
        const { username } = req.body;

        if (!username || typeof username !== 'string') {
            return res.status(400).json({ error: '请填写新的ID' });
        }

        // 仅允许字母/数字/下划线/中文，2-20位
        const usernameRegex = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/;
        if (!usernameRegex.test(username.trim())) {
            return res.status(400).json({ error: 'ID需为2-20位字母、数字、下划线或中文' });
        }

        const finalUsername = username.trim();

        // 检查是否已被他人使用
        const existing = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', [finalUsername, req.userId]);
        if (existing) {
            return res.status(400).json({ error: '该ID已被其他用户使用' });
        }

        // 与当前ID相同则直接成功
        const current = await db.get('SELECT username FROM users WHERE id = ?', [req.userId]);
        if (current && current.username === finalUsername) {
            return res.json({ message: 'ID未发生变化', username: finalUsername });
        }

        await db.run(
            'UPDATE users SET username = ?, updated_at = ? WHERE id = ?',
            [finalUsername, getLocalTimestamp(), req.userId]
        );

        res.json({ message: 'ID修改成功', username: finalUsername });
    } catch (error) {
        logger.error('修改ID错误:', error);
        res.status(500).json({ error: '修改ID失败' });
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
        logger.error('修改密码错误:', error);
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
        logger.error('发送绑定验证码错误:', error);
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
        logger.error('验证邮箱错误:', error);
        res.status(500).json({ error: '验证邮箱失败' });
    }
});

// 通过用户名获取用户信息（公开接口）
router.get('/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        const user = await db.get(
            `SELECT u.id, u.username, u.nickname, u.email, u.avatar, u.cover, u.level, u.contribution, u.skin_path, u.created_at,
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
        logger.error('获取用户信息错误:', error);
        res.status(500).json({ error: '获取用户信息失败' });
    }
});

// ============ QQ登录（心月互联） ============

// 调用心月互联获取QQ用户信息
async function fetchQQUserInfo(code) {
    const url = `https://qq.wch666.com/api/get_user_info.php?code=${encodeURIComponent(code)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();

    // 尝试JSON解析
    try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object') return data;
    } catch (e) { /* 非JSON格式 */ }

    // 尝试 "key=value&..." 格式
    try {
        const data = {};
        text.split(/[&;\n]/).forEach(pair => {
            const [k, v] = pair.split('=');
            if (k && v) data[k.trim()] = decodeURIComponent(v.trim());
        });
        if (Object.keys(data).length > 0) return data;
    } catch (e) { /* 解析失败 */ }

    return { error: text };
}

// 从心月互联返回的数据中提取标准用户信息
function extractQQUserInfo(data) {
    const openid = data.openid || data.uid || data.id || data.open_id;
    const nickname = data.nickname || data.nick || data.name || 'QQ用户';
    const avatar = data.avatar || data.figureurl_qq_2 || data.figureurl_qq_1 || data.headimgurl || '';
    return { openid: String(openid || ''), nickname: String(nickname), avatar: String(avatar || '') };
}

// QQ登录：跳转到心月互联授权页
router.get('/qq/login', (req, res) => {
    const token = process.env.QQ_LOGIN_TOKEN;
    if (!token) {
        return res.status(500).send('QQ登录未配置：请在 .env 中设置 QQ_LOGIN_TOKEN');
    }
    const redirect = req.query.redirect || '';
    const url = `https://qq.wch666.com/api/qq.php?token=${encodeURIComponent(token)}&msg=${encodeURIComponent(redirect)}`;
    res.redirect(url);
});

// QQ绑定：已登录用户绑定QQ（跳转到心月互联授权页）
// 支持 Authorization header 或 ?token= 查询参数（浏览器直接跳转场景）
router.get('/qq/bind', async (req, res) => {
    try {
        let token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token;
        if (!token) {
            return res.status(401).json({ error: '未提供认证令牌' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: '认证令牌无效或已过期' });
        }

        const qqToken = process.env.QQ_LOGIN_TOKEN;
        if (!qqToken) {
            return res.status(500).send('QQ登录未配置：请在 .env 中设置 QQ_LOGIN_TOKEN');
        }
        // msg 携带绑定标识：bind_<userId>
        const url = `https://qq.wch666.com/api/qq.php?token=${encodeURIComponent(qqToken)}&msg=${encodeURIComponent('bind_' + decoded.userId)}`;
        res.redirect(url);
    } catch (error) {
        logger.error('QQ绑定跳转错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// QQ登录回调：换取用户信息并登录/注册
router.get('/qq/callback', async (req, res) => {
    try {
        const { code, msg } = req.query;
        if (!code) {
            return res.redirect('/login?error=' + encodeURIComponent('QQ登录失败：缺少授权码'));
        }

        const data = await fetchQQUserInfo(code);
        if (data.error) {
            logger.error('获取QQ用户信息失败:', data.error);
            return res.redirect('/login?error=' + encodeURIComponent('QQ登录失败：获取用户信息出错'));
        }

        const { openid, nickname, avatar } = extractQQUserInfo(data);
        if (!openid) {
            logger.error('QQ返回数据缺少openid:', JSON.stringify(data));
            return res.redirect('/login?error=' + encodeURIComponent('QQ登录失败：未获取到用户标识'));
        }

        // ===== 绑定流程：msg 为 bind_<userId> =====
        if (msg && msg.startsWith('bind_')) {
            const bindUserId = parseInt(msg.slice(5));
            if (!bindUserId) {
                return res.redirect('/settings?error=' + encodeURIComponent('绑定参数无效'));
            }

            // 检查该openid是否已被其他用户绑定
            const existingBind = await db.get('SELECT id FROM users WHERE openid = ? AND id != ?', [openid, bindUserId]);
            if (existingBind) {
                return res.redirect('/settings?error=' + encodeURIComponent('该QQ已绑定其他账号，无法重复绑定'));
            }

            await db.run('UPDATE users SET openid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [openid, bindUserId]);

            return res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>绑定成功 - 玄剑公会</title>
    <style>body{background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#fff;font-family:sans-serif;}</style>
</head>
<body>
    <div style="text-align:center;">
        <div style="font-size:40px;margin-bottom:16px;">✓</div>
        <p>QQ绑定成功，正在跳转...</p>
    </div>
    <script>
        window.location.href = '/settings';
    </script>
</body>
</html>`);
        }

        // ===== 登录流程 =====
        // 查找是否已有绑定该openid的用户
        let user = await db.get('SELECT * FROM users WHERE openid = ?', [openid]);

        if (!user) {
            // 创建新用户（邮箱留空，待用户手动绑定）
            const randomPassword = crypto.randomBytes(24).toString('hex');
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            let username = 'qq_' + openid.slice(-10);

            // 处理用户名冲突
            const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
            if (existing) {
                username = username + '_' + Math.floor(Math.random() * 10000);
            }

            const result = await db.run(
                `INSERT INTO users (username, nickname, email, password, avatar, openid, contribution, email_verified, password_set, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [username, nickname, null, hashedPassword, avatar || '/images/default-avatar.png', openid]
            );

            user = await db.get('SELECT * FROM users WHERE id = ?', [result.id]);
        }

        // 签发JWT（QQ登录固定30天有效）
        const token = jwt.sign(
            { userId: user.id, username: user.username, level: user.level },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        const safeUser = { ...user };
        delete safeUser.password;
        safeUser.qq_bound = true;
        safeUser.email_bound = !!(user.email && user.email.trim() !== '');

        // 返回HTML页面，前端自动保存登录态后跳转
        const redirect = msg || '/';
        res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>登录成功 - 玄剑公会</title>
    <style>body{background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#fff;font-family:sans-serif;}</style>
</head>
<body>
    <div style="text-align:center;">
        <div style="font-size:40px;margin-bottom:16px;">✓</div>
        <p>登录成功，正在跳转...</p>
    </div>
    <script>
        localStorage.setItem('token', ${JSON.stringify(token)});
        localStorage.setItem('user', ${JSON.stringify(safeUser)});
        window.location.href = ${JSON.stringify(redirect)};
    </script>
</body>
</html>`);
    } catch (error) {
        logger.error('QQ登录回调错误:', error);
        res.status(500).send('QQ登录处理失败');
    }
});

module.exports = router;
