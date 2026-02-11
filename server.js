const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const announcementRoutes = require('./routes/announcement');

const app = express();
const PORT = process.env.PORT || 3000;

// 安全中间件
app.use(helmet({
    contentSecurityPolicy: false
}));

// CORS配置
app.use(cors());

// 请求限制
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100 // 每个IP限制100个请求
});
app.use('/api/', limiter);

// 解析JSON请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

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

// 页面路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/daily', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'daily.html'));
});

app.get('/decision', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'decision.html'));
});

app.get('/forum', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'forum.html'));
});

app.get('/post/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'post-detail.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'register.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'profile.html'));
});

app.get('/editor', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'editor.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'admin.html'));
});

app.get('/social', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'social.html'));
});

// 404处理
app.use((req, res) => {
    res.status(404).json({ error: '请求的资源不存在' });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`玄剑公会官网服务器已启动`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`=================================`);
});

module.exports = app;
