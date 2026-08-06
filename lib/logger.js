// 项目日志系统
// 支持控制台输出（带颜色）与文件输出（data/logs/app-YYYY-MM-DD.log，按天轮转）
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'data', 'logs');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const COLORS = {
    INFO: '\x1b[36m',
    WARN: '\x1b[33m',
    ERROR: '\x1b[31m',
    RESET: '\x1b[0m'
};

function pad(n) {
    return String(n).padStart(2, '0');
}

function formatTime() {
    return new Date().toISOString();
}

function todayLogFile() {
    const d = new Date();
    return path.join(LOG_DIR, `app-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.log`);
}

/**
 * 写入日志：控制台 + 文件（异步追加）
 */
function write(level, msg, meta) {
    const line = `[${formatTime()}] [${level}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
    // 控制台
    console.log(`${COLORS[level] || ''}${line}${COLORS.RESET}`);
    // 文件
    try {
        fs.appendFile(todayLogFile(), line + '\n', () => {});
    } catch (e) {
        // 忽略文件写入错误
    }
}

const logger = {
    info(msg, meta) { write('INFO', msg, meta); },
    warn(msg, meta) { write('WARN', msg, meta); },
    error(msg, meta) { write('ERROR', msg, meta); },

    /**
     * 请求日志中间件：记录方法、路径、状态码、耗时与用户
     */
    requestLogger(req, res, next) {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            const userId = req.userId || (req.auth && req.auth.id) || '';
            logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, { ip: req.ip, userId });
        });
        next();
    }
};

module.exports = logger;
