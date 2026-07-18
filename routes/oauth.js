const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const database = require('../database');
const JWT_SECRET = process.env.JWT_SECRET || 'xuanjian_guild_secret_key_2024';

// 授权码临时存储（生产环境应使用数据库）
const authCodes = new Map();

/**
 * OAuth 授权页面
 * GET /api/oauth/authorize
 * 参数：client_id, redirect_uri, response_type=code, state
 */
router.get('/authorize', async (req, res) => {
    try {
        const { client_id, redirect_uri, response_type, state } = req.query;
        
        // 验证必需参数
        if (!client_id || !redirect_uri || response_type !== 'code') {
            return res.status(400).json({ error: '缺少必要参数或参数错误' });
        }

        // 始终返回HTML页面，由前端JavaScript判断登录状态
        res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>授权确认 - 玄剑公会</title>
    <link rel="stylesheet" href="/css/style.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7)), url('/2.png') center/cover no-repeat;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
        }
        .oauth-container {
            background: rgba(255, 255, 255, 0.285);
            padding: 40px;
            border-radius: 20px;
            max-width: 420px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .oauth-logo {
            width: 80px;
            height: 80px;
            margin-bottom: 24px;
            border-radius: 16px;
        }
        .oauth-title {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
            color: #fff;
        }
        .oauth-subtitle {
            color: #94979a;
            font-size: 14px;
            margin-bottom: 24px;
        }
        .app-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(99, 102, 241, 0.2);
            color: #fff;
            padding: 10px 16px;
            border-radius: 8px;
            font-weight: 500;
            margin-bottom: 24px;
            font-size: 14px;
        }
        .user-info {
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 24px;
        }
        .user-avatar-img {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            object-fit: cover;
            margin: 0 auto 12px;
            display: block;
            background: #e2e8f0;
        }
        .user-name {
            color: #fff;
            font-weight: 600;
            font-size: 16px;
        }
        .user-label {
            color: #94979a;
            font-size: 12px;
            margin-top: 4px;
        }
        .oauth-buttons {
            display: flex;
            gap: 12px;
        }
        .btn {
            flex: 1;
            padding: 12px 20px;
            border-radius: 10px;
            font-size: 15px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s;
            border: none;
        }
        .btn-allow {
            background: #6366f1;
            color: white;
        }
        .btn-allow:hover {
            background: #4f46e5;
        }
        .btn-deny {
            background: rgba(255,255,255,0.1);
            color: #94979a;
        }
        .btn-deny:hover {
            background: rgba(255,255,255,0.2);
        }
        .loading {
            color: #94979a;
            font-size: 14px;
        }
        .loading::after {
            content: '';
            animation: dots 1.5s infinite;
        }
        @keyframes dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60%, 100% { content: '...'; }
        }
        .oauth-notice {
            color: #6b7280;
            font-size: 12px;
            margin-top: 20px;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="oauth-container">
        <img src="/icon.png" class="oauth-logo" alt="玄剑公会">
        <h1 class="oauth-title">授权确认</h1>
        <p id="status" class="loading">正在检查登录状态</p>
    </div>
    <script>
        const params = new URLSearchParams(window.location.search);
        const clientId = params.get('client_id');
        const redirectUri = params.get('redirect_uri');
        const state = params.get('state');
        
        const token = localStorage.getItem('token');
        
        if (!token) {
            const loginUrl = '/login?redirect=/api/oauth/authorize&client_id=' + clientId + '&redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + (state || '');
            window.location.href = loginUrl;
        } else {
            fetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + token }
            })
            .then(r => r.json())
            .then(data => {
                if (data.id) {
                    const avatarUrl = data.avatar || '/uploads/default-avatar.png';
                    document.getElementById('status').outerHTML = \`
                        <p class="oauth-subtitle">第三方应用请求访问您的账号</p>
                        <div class="app-badge">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                            \${clientId}
                        </div>
                        <div class="user-info">
                            <img class="user-avatar-img" src="\${avatarUrl}" alt="头像" onerror="this.src='/uploads/default-avatar.png'">
                            <div class="user-name">\${data.username}</div>
                            <div class="user-label">当前登录账号</div>
                        </div>
                        <div class="oauth-buttons">
                            <button class="btn btn-deny" onclick="denyAuth()">拒绝</button>
                            <button class="btn btn-allow" onclick="allowAuth()">允许授权</button>
                        </div>
                        <p class="oauth-notice">授权后，该应用将获取您的基本信息<br>包括用户名、权限等级等</p>
                    \`;
                } else {
                    localStorage.removeItem('token');
                    const loginUrl = '/login?redirect=/api/oauth/authorize&client_id=' + clientId + '&redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + (state || '');
                    window.location.href = loginUrl;
                }
            })
            .catch(err => {
                localStorage.removeItem('token');
                const loginUrl = '/login?redirect=/api/oauth/authorize&client_id=' + clientId + '&redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + (state || '');
                window.location.href = loginUrl;
            });
        }
        
        function allowAuth() {
            fetch('/api/oauth/authorize', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + localStorage.getItem('token'),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ client_id: clientId, redirect_uri: redirectUri, state: state })
            })
            .then(r => r.json())
            .then(data => {
                if (data.code) {
                    window.location.href = redirectUri + '?code=' + data.code + '&state=' + (state || '');
                } else {
                    alert('授权失败：' + (data.error || '未知错误'));
                }
            })
            .catch(err => alert('授权请求失败'));
        }
        
        function denyAuth() {
            window.location.href = redirectUri + '?error=access_denied&state=' + (state || '');
        }
    </script>
</body>
</html>
        `);
    } catch (err) {
        console.error('OAuth authorize error:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

/**
 * 同意授权，生成授权码
 * POST /api/oauth/authorize
 */
router.post('/authorize', async (req, res) => {
    try {
        const { client_id, redirect_uri, state } = req.body;
        
        // 验证 Token
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: '未登录' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Token 无效' });
        }

        // 生成授权码（有效期5分钟）
        const code = generateAuthCode();
        authCodes.set(code, {
            userId: decoded.userId,
            username: decoded.username,
            level: decoded.level,
            client_id,
            redirect_uri,
            createdAt: Date.now()
        });

        // 5分钟后自动删除授权码
        setTimeout(() => authCodes.delete(code), 5 * 60 * 1000);

        res.json({ code, state });
    } catch (err) {
        console.error('OAuth authorize POST error:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

/**
 * 使用授权码换取访问令牌
 * POST /api/oauth/token
 * 参数：code, client_id, client_secret, redirect_uri, grant_type=authorization_code
 */
router.post('/token', async (req, res) => {
    try {
        const { code, client_id, client_secret, redirect_uri, grant_type } = req.body;

        // 验证参数
        if (grant_type !== 'authorization_code' || !code || !client_id) {
            return res.status(400).json({ error: 'invalid_request' });
        }

        // 验证授权码
        const authData = authCodes.get(code);
        if (!authData) {
            return res.status(400).json({ error: 'invalid_code', error_description: '授权码无效或已过期' });
        }

        // 验证 client_id 和 redirect_uri
        if (authData.client_id !== client_id || authData.redirect_uri !== redirect_uri) {
            authCodes.delete(code);
            return res.status(400).json({ error: 'invalid_client' });
        }

        // 删除已使用的授权码（一次性使用）
        authCodes.delete(code);

        // 生成访问令牌（7天有效）
        const accessToken = jwt.sign(
            {
                userId: authData.userId,
                username: authData.username,
                level: authData.level,
                client_id: client_id
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 7 * 24 * 60 * 60, // 7天（秒）
            scope: 'read_user'
        });
    } catch (err) {
        console.error('OAuth token error:', err);
        res.status(500).json({ error: 'server_error' });
    }
});

/**
 * 验证访问令牌
 * GET /api/oauth/verify
 */
router.get('/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ valid: false, error: 'missing_token' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ valid: false, error: 'invalid_token' });
        }

        // 获取最新用户信息
        let user;
        try {
            // 尝试查询包含title_id的schema
            user = await database.get(
                'SELECT id, username, avatar, level, title_id, contribution FROM users WHERE id = ?',
                [decoded.userId]
            );
        } catch (e) {
            // 如果title_id列不存在，使用备用查询
            if (e.code === 'SQLITE_ERROR') {
                user = await database.get(
                    'SELECT id, username, avatar, level, contribution FROM users WHERE id = ?',
                    [decoded.userId]
                );
            } else {
                throw e;
            }
        }

        if (!user) {
            return res.status(404).json({ valid: false, error: 'user_not_found' });
        }

        // 获取称号名称（如果title_id存在）
        let titleName = null;
        if (user.title_id) {
            try {
                const title = await database.get('SELECT name FROM titles WHERE id = ?', [user.title_id]);
                titleName = title?.name;
            } catch (e) {
                // titles表可能不存在，忽略错误
            }
        }

        // 构建完整头像URL
        const avatarUrl = user.avatar
            ? (user.avatar.startsWith('http') ? user.avatar : `https://xuanjian.top${user.avatar}`)
            : 'https://xuanjian.top/uploads/default-avatar.png';

        res.json({
            valid: true,
            user: {
                id: user.id,
                username: user.username,
                avatar: avatarUrl,
                level: user.level,
                title: titleName,
                contribution: user.contribution
            }
        });
    } catch (err) {
        console.error('OAuth verify error:', err);
        res.status(500).json({ valid: false, error: 'server_error' });
    }
});

/**
 * 获取用户详细信息
 * GET /api/oauth/userinfo
 */
router.get('/userinfo', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'missing_token' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'invalid_token' });
        }

        // 获取用户详细信息
        const user = await database.get(
            'SELECT id, username, email, level, title_id, contribution, created_at FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (!user) {
            return res.status(404).json({ error: 'user_not_found' });
        }

        // 获取称号
        let title = null;
        if (user.title_id) {
            const titleData = await database.get('SELECT name, color FROM titles WHERE id = ?', [user.title_id]);
            title = titleData;
        }

        // 获取签到信息
        const checkin = await database.get(
            'SELECT total_days, current_streak FROM checkin_records WHERE user_id = ?',
            [decoded.userId]
        );

        res.json({
            id: user.id,
            username: user.username,
            email_verified: !!user.email,
            level: user.level,
            title: title,
            contribution: user.contribution,
            checkin: checkin ? { total_days: checkin.total_days, streak: checkin.current_streak } : null,
            created_at: user.created_at
        });
    } catch (err) {
        console.error('OAuth userinfo error:', err);
        res.status(500).json({ error: 'server_error' });
    }
});

/**
 * 生成随机授权码
 */
function generateAuthCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 32; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

module.exports = router;