/**
 * Nezha → 邮件 告警中继
 *
 * Nezha V2 的通知方式是通用 Webhook。本服务接收 Nezha 的告警 Webhook，
 * 用官网同款企业邮箱（smtp.exmail.qq.com）把告警内容发到管理员邮箱。
 *
 * 监听 127.0.0.1:3999，由 nginx 的 https://monitor.xuanjian.top/hooks/email 反代进来
 * （Nezha 会拒绝私有地址 Webhook，所以必须走公网域名）。
 */
'use strict';
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const GUILD = '/var/www/xuanjian-guild';
function loadEnv() {
    try {
        require(path.join(GUILD, 'node_modules', 'dotenv')).config({ path: path.join(GUILD, '.env'), quiet: true });
    } catch (e) {
        console.error('[relay] dotenv 读取失败:', e.message);
    }
}
loadEnv();
const nodemailer = require(path.join(GUILD, 'node_modules', 'nodemailer'));

const PORT = Number(process.env.RELAY_PORT || 3999);
const SMTP = {
    host: process.env.SMTP_HOST || 'smtp.exmail.qq.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' }
};
const TO = (process.env.ALERT_TO || 'northland@xuanjian.top').split(',').map((s) => s.trim()).filter(Boolean);
const SUBJECT_PREFIX = process.env.ALERT_SUBJECT_PREFIX || '【北域工作室监控】';

if (!SMTP.auth.user || !SMTP.auth.pass) {
    console.error('[relay] 缺少 SMTP_USER / SMTP_PASS');
    process.exit(1);
}
const transporter = nodemailer.createTransport(SMTP);

/** 从 Nezha Webhook 请求体里取出标题与正文 */
function parseAlert(rawBody, req) {
    let title = '';
    let content = rawBody || '';
    try {
        const j = JSON.parse(rawBody);
        if (j && typeof j === 'object') {
            title = j.title || j.subject || j.name || '';
            content = j.content || j.body || j.message || j.text || rawBody;
            if (typeof content === 'object') content = JSON.stringify(content, null, 2);
        }
    } catch (e) {
        // 非 JSON：把 form 形式 a=b&c=d 还原成可读文本
        if (String(req.headers['content-type'] || '').includes('form')) {
            const params = new URLSearchParams(rawBody);
            title = params.get('title') || params.get('subject') || '';
            content = params.get('content') || params.get('body') || params.get('message') || rawBody;
        }
    }
    if (!title) {
        // 从正文里提取服务器名做标题
        const m = String(content).match(/(?:服务器|Server)[:：]?\s*([^\n,，]{1,40})/i);
        title = m ? `服务器告警：${m[1]}` : '服务器告警';
    }
    return { title: String(title).slice(0, 120), content: String(content) };
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
        return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, to: TO.length }));
    }
    if (req.method !== 'POST') return res.writeHead(405).end('method not allowed');
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 256 * 1024) req.destroy(); });
    req.on('end', async () => {
        const { title, content } = parseAlert(body, req);
        const subject = `${SUBJECT_PREFIX}${title}`;
        try {
            const info = await transporter.sendMail({
                from: SMTP.auth.user,
                to: TO.join(','),
                subject,
                text: content,
                html: `<pre style="font:13px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap">${content.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`
            });
            console.log(`[relay] 已发送: ${subject} -> ${TO.join(',')} (${info.messageId})`);
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
        } catch (e) {
            console.error('[relay] 发送失败:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: e.message }));
        }
    });
});
server.listen(PORT, '127.0.0.1', () => console.log(`[relay] listening 127.0.0.1:${PORT} -> ${TO.join(',')}`));
