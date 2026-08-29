const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('./lib/logger');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const announcementRoutes = require('./routes/announcement');
const { router: notificationRoutes } = require('./routes/notifications');
// 股票模块已停用隐藏（保留代码，关闭挂载与价格更新任务）
// const stockRoutes = require('./routes/stock');
const checkinRoutes = require('./routes/checkin');
const titleRoutes = require('./routes/titles');
const passwordRoutes = require('./routes/password');
const claimRoutes = require('./routes/claims');
const shopRoutes = require('./routes/shop');
const rankingRoutes = require('./routes/rankings');
const oauthRoutes = require('./routes/oauth');
const bannerRoutes = require('./routes/banners');
const updateRoutes = require('./routes/updates');
const contributionRoutes = require('./routes/contributions');
const taskRoutes = require('./routes/tasks');
const favoriteRoutes = require('./routes/favorites');
const skinRoutes = require('./routes/skins');
const playerTaskRoutes = require('./routes/player-tasks');
const disciplineRoutes = require('./routes/discipline');
const gmirsRoutes = require('./routes/gmirs');
const economicsRoutes = require('./routes/economics');
const modRoutes = require('./routes/mod');
const projectionRoutes = require('./routes/projections');
const launcherRoutes = require('./routes/launcher');
const pushRoutes = require('./routes/push');
const generationRoutes = require('./routes/generations');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// 记录全站页面浏览量（SPA 页面请求）
async function trackPageView() {
    try {
        await db.run(
            `INSERT INTO page_views (date, pv, updated_at) VALUES (DATE('now', 'localtime'), 1, ?)
             ON CONFLICT(date) DO UPDATE SET pv = pv + 1, updated_at = excluded.updated_at`,
            [db.getLocalTimestamp()]
        );
    } catch (e) {
        // 表不存在时静默忽略，不影响页面访问
    }
}

// 信任代理（Nginx反向代理）
app.set('trust proxy', 1);

// CORS配置
const corsOrigin = process.env.SITE_URL || 'https://xuanjian.top';
const corsOptions = {
    origin: (origin, callback) => {
        // Capacitor WebView 的 origin 为 https://localhost 或 capacitor://localhost
        if (!origin || origin === corsOrigin || origin.startsWith('https://localhost') || origin.startsWith('capacitor://')) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};
app.use(cors(corsOptions));

// 安全中间件
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://xuanjian.top", "https://cdn.jsdelivr.net", "https://up-as0.qiniup.com", "https://cdn.xuanjian.top"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false
}));


// 请求限制
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 300, // 每个IP限制300个请求
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试' }
});
app.use('/api/', limiter);

// 解析JSON请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 请求日志（写入控制台与 data/logs/ 文件）
app.use(logger.requestLogger);

// 静态文件服务 - 共享图片等资源（index关闭，避免抢占React入口）
app.use(express.static(path.join(__dirname, 'public'), {
    acceptRanges: false,
    etag: true,
    lastModified: true,
    maxAge: '1d',
    index: false
}));

// 上传文件服务 - 确保目录存在
const uploadsPath = path.join(__dirname, 'data', 'uploads');
if (!require('fs').existsSync(uploadsPath)) {
    require('fs').mkdirSync(uploadsPath, { recursive: true });
}
app.use('/uploads', express.static(uploadsPath));

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
// 股票API已停用
// app.use('/api/stock', stockRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/titles', titleRoutes);
app.use('/api/password', passwordRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/rankings', rankingRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/updates', updateRoutes);
app.use('/api/contributions', contributionRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/skins', skinRoutes);
app.use('/api/player-tasks', playerTaskRoutes);
app.use('/api/discipline', disciplineRoutes);
app.use('/api/gmirs', gmirsRoutes);
app.use('/api/economics', economicsRoutes);
app.use('/api/mod', modRoutes);
app.use('/api/projections', projectionRoutes);
app.use('/launcher', launcherRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/generations', generationRoutes);

// ============ React前端（frontend/dist）托管 ============
const frontendDist = path.join(__dirname, 'frontend', 'dist');
// 带版本hash的构建产物：长缓存
app.use('/assets', express.static(path.join(frontendDist, 'assets'), { maxAge: '30d', immutable: true }));
// React静态资源（不自动提供index.html，由SPA回退处理）
app.use(express.static(frontendDist, { index: false }));

// SPA回退：非API/上传请求统一返回React入口
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
        return next();
    }
    // 记录页面浏览量（不阻塞响应）
    trackPageView();
    res.sendFile(path.join(frontendDist, 'index.html'));
});

app.use((req, res) => {
    res.status(404).json({ error: '请求的资源不存在' });
});

// 错误处理
app.use((err, req, res, next) => {
    logger.error('服务器错误', { url: req.originalUrl, message: err.message, stack: err.stack });
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
const server = app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`玄剑公会官网服务器已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`=================================`);
});

// WebSocket 实时通知
const { initRealtime } = require('./lib/realtime');
initRealtime(server);

module.exports = app;
