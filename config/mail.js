const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.exmail.qq.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER || 'xuanjian_guild@xuanjian.top',
        pass: process.env.SMTP_PASS || 'Pm3FFATZgEYq2LeL'
    }
});

const FROM_EMAIL = `"玄剑公会" <${process.env.SMTP_USER || 'xuanjian_guild@xuanjian.top'}>`;

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
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa;">
            <div style="background: white; border-radius: 16px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.08);">
                <h2 style="color: #6366f1; margin-bottom: 20px;">玄剑公会邮箱验证</h2>
                <p style="color: #334155; font-size: 16px; line-height: 1.6;">您好！</p>
                <p style="color: #334155; font-size: 16px; line-height: 1.6;">您正在进行邮箱验证，您的验证码是：</p>
                <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
                    <span style="font-size: 32px; font-weight: bold; color: #6366f1; letter-spacing: 8px;">${code}</span>
                </div>
                <p style="color: #64748b; font-size: 14px;">验证码有效期为 10 分钟，请勿向他人透露。</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 20px;">如非本人操作，请忽略此邮件。</p>
                <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="color: #94a3b8; font-size: 12px; text-align: center;">我的世界玄剑公会 | https://xuanjian.top</p>
            </div>
        </div>
    `;
    return await sendEmail(email, '玄剑公会 - 邮箱验证码', html);
}

module.exports = {
    transporter,
    sendEmail,
    sendVerificationCode
};
