/**
 * 权限体系自动化测试——公共底座
 *
 * 安全约束：测试 **只使用临时数据库**（复制 data/guild.db 到系统临时目录后执行迁移），
 * 绝不连接/修改生产库 data/guild.db 或服务器数据库。
 *
 * 用法：每个测试文件在顶部 `const h = require('./permissions-harness')`，
 * 然后 `await h.setup('tag')` → 返回 { port, close(), ...工具 }。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const JWT_SECRET = 'perm-test-secret-do-not-use-in-prod';

let cleanupDirs = [];

function runNode(args, extraEnv = {}) {
    const r = spawnSync(process.execPath, args, {
        cwd: ROOT,
        env: { ...process.env, ...extraEnv },
        stdio: 'pipe',
        encoding: 'utf8'
    });
    if (r.status !== 0) {
        throw new Error(`命令失败: node ${args.join(' ')}\n${(r.stdout || '').slice(-2000)}\n${(r.stderr || '').slice(-4000)}`);
    }
    return r;
}

/** 构建临时测试库：复制开发库副本 + 执行权限/ Wiki 迁移 */
async function buildFixtureDb(tag) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xj-perm-${tag}-`));
    cleanupDirs.push(dir);
    const dbFile = path.join(dir, `perm-${tag}.db`);
    const src = path.join(ROOT, 'data', 'guild.db');
    if (!fs.existsSync(src)) throw new Error('缺少 data/guild.db 基准库（测试拒绝使用生产库）');
    fs.copyFileSync(src, dbFile);
    await ensureBaseSchema(dbFile);

    runNode(['migrations/run.js', `--db=${dbFile}`]);
    // Wiki 表（权限回归用）：迁移脚本支持 DB_FILE
    for (const script of ['scripts/migrate-wiki.js', 'scripts/migrate-wiki-review.js', 'scripts/migrate-wiki-reward.js']) {
        if (fs.existsSync(path.join(ROOT, script))) {
            runNode([script], { DB_FILE: dbFile });
        }
    }
    return { dir, dbFile };
}

/**
 * 用独立 sqlite3 连接补齐基准库缺失结构（只影响临时库）。
 * 开发库快照可能缺 generations 表 / users.generation 列（生产早已迁移），补齐后才能回归 /api/admin/users。
 */
async function ensureBaseSchema(dbFile) {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(dbFile);
    const run = (sql) => new Promise((res, rej) => db.exec(sql, (e) => (e ? rej(e) : res())));
    const all = (sql) => new Promise((res, rej) => db.all(sql, (e, rows) => (e ? rej(e) : res(rows))));
    try {
        await run('CREATE TABLE IF NOT EXISTS generations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
        const cols = (await all('PRAGMA table_info(users)')).map((c) => c.name);
        if (!cols.includes('generation')) await run('ALTER TABLE users ADD COLUMN generation TEXT');
        if (!cols.includes('qq')) await run('ALTER TABLE users ADD COLUMN qq TEXT');
    } finally {
        await new Promise((resolve) => db.close(() => resolve()));
    }
}

/** 启动只挂载被测路由的临时 Express 应用（不启动定时任务/SSR/Bot） */
function startApp() {
    const express = require('express');
    const app = express();
    app.use(express.json());

    const perms = require('../../lib/permissions');
    const { authMiddleware } = require('../../middleware/auth');

    // 与 server.js 相同的挂载顺序：经济资格闸门在业务路由之前
    app.use('/api', perms.economyGate);

    app.use('/api/permissions', require('../../routes/permissions'));
    app.use('/api/auth', require('../../routes/auth'));
    app.use('/api/admin', require('../../routes/admin'));
    app.use('/api/contributions', require('../../routes/contributions'));
    app.use('/api/wiki', require('../../routes/wiki'));
    app.use('/api/announcements', require('../../routes/announcement'));

    // 被测路由之外的“贡献点入口”打桩：用于验证经济闸门对所有接口生效（不依赖各业务模块表结构）
    const stubs = [
        ['post', '/api/checkin/checkin'],
        ['post', '/api/checkin/makeup'],
        ['get', '/api/checkin/status'],
        ['post', '/api/tasks/1/complete'],
        ['post', '/api/player-tasks'],
        ['post', '/api/player-tasks/1/complete'],
        ['post', '/api/shop/items/1/buy'],
        ['post', '/api/titles/1/buy'],
        ['post', '/api/chat/bubbles/1/buy'],
        ['post', '/api/market/orders'],
        ['post', '/api/express-index/buy'],
        ['post', '/api/express-index/sell'],
        ['post', '/api/pay/scan'],
        ['post', '/api/contribution-conversion/1/apply']
    ];
    for (const [method, url] of stubs) {
        app[method](url, authMiddleware, (req, res) => res.json({ ok: true, stub: true, url, userId: req.userId }));
    }

    app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found', code: 'NOT_FOUND' }));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        res.status(500).json({ ok: false, error: 'test_server_error', code: 'ERROR', detail: err.message });
    });

    return new Promise((resolve) => {
        const server = require('http').createServer(app);
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port, app });
        });
    });
}

async function setup(tag) {
    const { dir, dbFile } = await buildFixtureDb(tag);
    process.env.DB_FILE = dbFile;       // database.js 支持 DB_FILE（绝对路径）
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.RAG_DISABLE_WORKER = '1';
    process.env.SPA_ONLY = '1';
    // 测试环境邮件配置占位（config/mail.js 缺少 SMTP_PASS 会直接 exit，测试不发送邮件）
    process.env.SMTP_PASS = process.env.SMTP_PASS || 'test-smtp-pass';
    process.env.SMTP_USER = process.env.SMTP_USER || 'test@test.local';

    const { server, port } = await startApp();
    const db = require('../../database');
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');

    const api = async (method, url, { token = null, body = undefined } = {}) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`http://127.0.0.1:${port}${url}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let data = null;
        try { data = await res.json(); } catch (e) { data = {}; }
        return { status: res.status, data };
    };

    const tokenOf = (userId, level = 0) => jwt.sign(
        { userId, username: `u${userId}`, level },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    let seq = 0;
    const stamp = Date.now();
    const createUser = async ({ level = 0, contribution = 0, frozen = 0, suffix = '' } = {}) => {
        seq++;
        const username = `pt_${tag}_${stamp}_${seq}${suffix}`;
        const hash = await bcrypt.hash('Test123456', 4);
        const r = await db.run(
            `INSERT INTO users (username, nickname, email, password, level, contribution, is_frozen, password_set, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'), datetime('now','localtime'))`,
            [username, `测试${username}`, `${username}@test.local`, hash, level, contribution, frozen]
        );
        return { id: r.id, username, level, contribution, token: tokenOf(r.id, level) };
    };

    const setLevel = (userId, level) => db.run('UPDATE users SET level = ? WHERE id = ?', [level, userId]);
    const setFrozen = (userId, frozen) => db.run('UPDATE users SET is_frozen = ? WHERE id = ?', [frozen ? 1 : 0, userId]);
    const setContribution = (userId, amount) => db.run('UPDATE users SET contribution = ? WHERE id = ?', [amount, userId]);
    const getRoleId = async (key) => (await db.get('SELECT id FROM permission_roles WHERE key = ?', [key]))?.id;

    const close = () => new Promise((resolve) => server.close(() => resolve()));

    return { db, port, api, tokenOf, createUser, setLevel, setFrozen, setContribution, getRoleId, close, JWT_SECRET, dir, dbFile };
}

function cleanup() {
    for (const dir of cleanupDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
    }
    cleanupDirs = [];
}

/** 轻量断言器 */
function createAssert() {
    const results = [];
    let passed = 0;
    let failed = 0;
    const check = (name, cond, extra) => {
        if (cond) {
            passed++;
            console.log(`  ✔ ${name}`);
        } else {
            failed++;
            console.log(`  ✘ ${name}${extra !== undefined ? '  →  ' + JSON.stringify(extra) : ''}`);
            results.push({ name, extra });
        }
        return !!cond;
    };
    const section = (title) => console.log(`\n== ${title} ==`);
    const summary = (title) => {
        console.log(`\n${failed === 0 ? '全部通过' : '存在失败'}：${title}  通过 ${passed} / 失败 ${failed}`);
        return failed === 0;
    };
    return { check, section, summary, get passed() { return passed; }, get failed() { return failed; } };
}

module.exports = { setup, cleanup, createAssert, ROOT, JWT_SECRET };
