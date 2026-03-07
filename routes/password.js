const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { sendEmail } = require('../config/mail');
const router = express.Router();

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: '请输入邮箱地址' });
        }
        
        const user = await db.get(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        
        if (!user) {
            return res.status(404).json({ error: '该邮箱未绑定任何账号' });
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 3600000);
        
        await db.run(
            'INSERT INTO password_resets (user_id, email, token, expires_at) VALUES (?, ?, ?, ?)',
            [user.id, email, token, expiresAt.toISOString()]
        );
        
        const resetUrl = `${process.env.SITE_URL || 'https://xuanjian.top'}/reset-password?token=${token}`;
        
        await sendEmail(email, '玄剑公会 - 密码重置', `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #6366f1;">密码重置</h2>
                <p>您好，${user.nickname || user.username}！</p>
                <p>我们收到了重置您账号密码的请求。请点击下方按钮重置密码：</p>
                <a href="${resetUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 16px 0;">重置密码</a>
                <p>或复制以下链接到浏览器：</p>
                <p style="word-break: break-all; color: #6366f1;">${resetUrl}</p>
                <p style="color: #999; font-size: 12px;">此链接将在1小时后失效。如果您没有请求重置密码，请忽略此邮件。</p>
            </div>
        `);
        
        res.json({ message: '重置邮件已发送，请查收邮箱' });
    } catch (error) {
        console.error('忘记密码错误:', error);
        res.status(500).json({ error: '发送重置邮件失败' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        
        if (!token || !newPassword) {
            return res.status(400).json({ error: '参数不完整' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: '密码长度至少6位' });
        }
        
        const reset = await db.get(
            'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?',
            [token, new Date().toISOString()]
        );
        
        if (!reset) {
            return res.status(400).json({ error: '重置链接无效或已过期' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        await db.run(
            'UPDATE users SET password = ?, updated_at = ? WHERE id = ?',
            [hashedPassword, getLocalTimestamp(), reset.user_id]
        );
        
        await db.run(
            'UPDATE password_resets SET used = 1 WHERE id = ?',
            [reset.id]
        );
        
        res.json({ message: '密码重置成功，请使用新密码登录' });
    } catch (error) {
        console.error('重置密码错误:', error);
        res.status(500).json({ error: '重置密码失败' });
    }
});

router.get('/verify-reset-token/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        const reset = await db.get(
            'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > ?',
            [token, new Date().toISOString()]
        );
        
        if (!reset) {
            return res.status(400).json({ valid: false, error: '重置链接无效或已过期' });
        }
        
        res.json({ valid: true });
    } catch (error) {
        console.error('验证token错误:', error);
        res.status(500).json({ valid: false, error: '验证失败' });
    }
});

module.exports = router;
