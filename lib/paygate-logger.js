/**
 * 支付网关专用日志模块
 * 独立命名空间与日志文件（data/logs/paygate-YYYY-MM-DD.log），便于对账与审计外站兑换。
 * 同时写入 pay_logs 审计表（关键动作落库），与业务流水分离。
 */
const fs = require('fs');
const path = require('path');
const db = require('../database');

const LOG_DIR = path.join(__dirname, '..', 'data', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function pad(n) { return String(n).padStart(2, '0'); }
function formatTime() { return new Date().toISOString(); }
function todayLogFile() {
    const d = new Date();
    return path.join(LOG_DIR, `paygate-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.log`);
}
function append(line) {
    try { fs.appendFile(todayLogFile(), line + '\n', () => {}); } catch (e) { /* 忽略 */ }
}

/**
 * 写支付网关日志（文件 + 控制台）
 * @param {string} level  INFO/WARN/ERROR
 * @param {string} action 动作（order.create / order.handle / notify.callback 等）
 * @param {object} meta 结构化附加（含 orderNo/siteId/userId）
 */
function log(level, action, meta) {
    const line = `[${formatTime()}] [${level}] ${action}${meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`;
    console.log(`${level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[36m'}${line}\x1b[0m`);
    append(line);
}

/**
 * 审计落库：记录一次关键兑换动作到 pay_logs
 */
async function audit({ orderNo, siteId, action, detail }) {
    try {
        await db.run(
            'INSERT INTO pay_logs (order_no, site_id, action, detail) VALUES (?, ?, ?, ?)',
            [orderNo || null, siteId || null, action || '', JSON.stringify(detail || null)]
        );
    } catch (e) {
        log('ERROR', 'audit.write_failed', { orderNo, error: e.message });
    }
}

const paygateLogger = {
    info: (action, meta) => log('INFO', action, meta),
    warn: (action, meta) => log('WARN', action, meta),
    error: (action, meta) => log('ERROR', action, meta),
    audit,
    payLogPath: todayLogFile
};

module.exports = paygateLogger;
