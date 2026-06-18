const nodemailer = require('nodemailer');

if (!process.env.SMTP_PASS) {
    console.error('错误: 未配置 SMTP_PASS 环境变量，请在 .env 文件中设置');
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    host: 'smtp.exmail.qq.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const FROM_EMAIL = `"玄剑公会" <${process.env.SMTP_USER}>`;

const SITE_URL = process.env.SITE_URL || 'https://xuanjian.top';
const LOGO_URL = 'https://xuanjian.top/icon.png';
const BANNER_URL = 'https://xuanjian.top/2.png';

function getEmailTemplate(options) {
    const {
        title = '玄剑公会',
        greeting = '您好！',
        content = '',
        actionButton = null,
        footer = null,
        accentColor = '#6366f1'
    } = options;

    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f1f5f9;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
                    
                    <tr>
                        <td style="background: linear-gradient(135deg, ${accentColor} 0%, #4f46e5 100%); padding: 30px 40px; text-align: center;">
                            <img src="${LOGO_URL}" alt="玄剑公会" style="width: 60px; height: 60px; margin-bottom: 16px; border-radius: 12px;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 1px;">玄剑公会</h1>
                            <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">我的世界 · 共创辉煌</p>
                        </td>
                    </tr>
                    
                    <tr>
                        <td style="padding: 40px;">
                            <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 22px; font-weight: 600;">${title}</h2>
                            
                            <p style="margin: 0 0 24px 0; color: #475569; font-size: 16px; line-height: 1.6;">${greeting}</p>
                            
                            ${content}
                            
                            ${actionButton ? `
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 32px 0;">
                                <tr>
                                    <td style="border-radius: 8px; background: ${accentColor};">
                                        <a href="${actionButton.url}" target="_blank" style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">${actionButton.text}</a>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                            
                            ${footer ? `
                            <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0;">
                                ${footer}
                            </div>
                            ` : ''}
                        </td>
                    </tr>
                    
                    <tr>
                        <td style="background-color: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                <tr>
                                    <td style="text-align: center;">
                                        <img src="${BANNER_URL}" alt="玄剑公会" style="width: 100%; max-width: 200px; border-radius: 8px; margin-bottom: 16px;">
                                        <p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px;">
                                            <a href="${SITE_URL}" style="color: ${accentColor}; text-decoration: none;">${SITE_URL}</a>
                                        </p>
                                        <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                                            此邮件由系统自动发送，请勿直接回复
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}

async function sendEmail(to, subject, html) {
    const mailOptions = {
        from: FROM_EMAIL,
        to,
        subject,
        html
    };
    return await transporter.sendMail(mailOptions);
}

async function sendVerificationCode(email, code) {
    const html = getEmailTemplate({
        title: '邮箱验证',
        greeting: '您正在进行邮箱验证操作，请使用以下验证码完成验证：',
        content: `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                    <td style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; padding: 32px; text-align: center; border: 2px dashed #e2e8f0;">
                        <span style="font-size: 36px; font-weight: 700; color: #6366f1; letter-spacing: 8px; font-family: 'Courier New', monospace;">${code}</span>
                    </td>
                </tr>
            </table>
        `,
        footer: `
            <p style="margin: 0; color: #64748b; font-size: 14px; text-align: center;">
                <strong>验证码有效期 10 分钟</strong>，请勿向他人透露
            </p>
            <p style="margin: 12px 0 0 0; color: #94a3b8; font-size: 13px; text-align: center;">
                如非本人操作，请忽略此邮件
            </p>
        `
    });
    return await sendEmail(email, '玄剑公会 - 邮箱验证码', html);
}

async function sendPasswordReset(email, user, resetUrl) {
    const html = getEmailTemplate({
        title: '密码重置',
        greeting: `您好，${user.nickname || user.username}！`,
        content: `
            <p style="margin: 0 0 16px 0; color: #475569; font-size: 16px; line-height: 1.6;">
                我们收到了重置您账号密码的请求。请点击下方按钮重置密码：
            </p>
            <p style="margin: 0; color: #64748b; font-size: 14px; line-height: 1.6;">
                或复制以下链接到浏览器：<br>
                <code style="display: inline-block; margin-top: 8px; padding: 8px 12px; background: #f1f5f9; border-radius: 6px; font-size: 13px; color: #6366f1; word-break: break-all;">${resetUrl}</code>
            </p>
        `,
        actionButton: {
            text: '重置密码',
            url: resetUrl
        },
        footer: `
            <p style="margin: 0; color: #ef4444; font-size: 14px; text-align: center;">
                <strong>此链接将在 1 小时后失效</strong>
            </p>
            <p style="margin: 12px 0 0 0; color: #94a3b8; font-size: 13px; text-align: center;">
                如果您没有请求重置密码，请忽略此邮件
            </p>
        `
    });
    return await sendEmail(email, '玄剑公会 - 密码重置', html);
}

async function sendClaimNotification(email, claim) {
    const html = getEmailTemplate({
        title: '新的贡献点申报',
        greeting: '有新的贡献点申报需要您审核：',
        content: `
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #f8fafc; border-radius: 12px; padding: 24px;">
                <tr>
                    <td style="padding: 8px 0;">
                        <span style="color: #64748b; font-size: 14px;">申报人：</span>
                        <span style="color: #1e293b; font-size: 16px; font-weight: 600;">${claim.nickname || claim.username}</span>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;">
                        <span style="color: #64748b; font-size: 14px;">申报数量：</span>
                        <span style="color: #f59e0b; font-size: 20px; font-weight: 700;">${claim.amount}</span>
                        <span style="color: #64748b; font-size: 14px;">贡献点</span>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;">
                        <span style="color: #64748b; font-size: 14px;">申报原因：</span>
                        <span style="color: #1e293b; font-size: 14px;">${claim.reason}</span>
                    </td>
                </tr>
            </table>
        `,
        actionButton: {
            text: '前往审核',
            url: `${SITE_URL}/admin`
        },
        accentColor: '#8b5cf6'
    });
    return await sendEmail(email, '玄剑公会 - 新的贡献点申报', html);
}

async function sendClaimResult(email, claim, status, reviewNote) {
    const isApproved = status === 'approved';
    const statusText = isApproved ? '已通过' : '已拒绝';
    const accentColor = isApproved ? '#10b981' : '#ef4444';
    
    const html = getEmailTemplate({
        title: `贡献点申报${statusText}`,
        greeting: `您好，${claim.nickname || claim.username}！`,
        content: `
            <p style="margin: 0 0 24px 0; color: #475569; font-size: 16px; line-height: 1.6;">
                您提交的贡献点申报已经审核完成。
            </p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #f8fafc; border-radius: 12px; padding: 24px;">
                <tr>
                    <td style="padding: 8px 0;">
                        <span style="color: #64748b; font-size: 14px;">申报数量：</span>
                        <span style="color: #f59e0b; font-size: 20px; font-weight: 700;">${claim.amount}</span>
                        <span style="color: #64748b; font-size: 14px;">贡献点</span>
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;">
                        <span style="color: #64748b; font-size: 14px;">审核结果：</span>
                        <span style="display: inline-block; padding: 4px 12px; background: ${isApproved ? '#d1fae5' : '#fee2e2'}; color: ${isApproved ? '#065f46' : '#991b1b'}; border-radius: 9999px; font-size: 14px; font-weight: 600;">${statusText}</span>
                    </td>
                </tr>
                ${reviewNote ? `
                <tr>
                    <td style="padding: 8px 0;">
                        <span style="color: #64748b; font-size: 14px;">审核备注：</span>
                        <span style="color: #1e293b; font-size: 14px;">${reviewNote}</span>
                    </td>
                </tr>
                ` : ''}
            </table>
            ${isApproved ? `
            <p style="margin: 24px 0 0 0; color: #10b981; font-size: 16px; font-weight: 600; text-align: center;">
                贡献点已发放至您的账户
            </p>
            ` : ''}
        `,
        actionButton: {
            text: '查看详情',
            url: `${SITE_URL}/claims`
        },
        accentColor: accentColor
    });
    return await sendEmail(email, `玄剑公会 - 贡献点申报${statusText}`, html);
}

module.exports = {
    transporter,
    sendEmail,
    getEmailTemplate,
    sendVerificationCode,
    sendPasswordReset,
    sendClaimNotification,
    sendClaimResult
};
