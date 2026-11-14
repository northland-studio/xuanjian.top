/**
 * GIS 测试工具（临时库 + 迁移 + 迷你 Express app + 断言）。
 *
 * 用法（在仓库根目录）：
 *   node scripts/tests/gis-api-test.js
 *   node scripts/tests/gis-migration-test.js
 *   node scripts/tests/gis-terrain-test.js
 *   node scripts/tests/gis-market-test.js
 *
 * 设计：
 *  - 每个测试脚本用独立临时库 data/gis-test-<pid>.db，绝不碰 data/guild.db；
 *  - 表结构由 migrations/run.js 真实执行（含权限组 100-104 迁移），顺带验证跨模块迁移兼容；
 *  - 先造「基线表 + 基线数据」（users/wiki_pages/market_stores/market_store_locations），再跑迁移；
 *  - 通过 HTTP 打真实 express 路由（fetch），不 mock 业务层。
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { execFileSync } = require('child_process');
const assert = require('assert');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..', '..');
process.env.GIS_DISABLE_JOBS = '1';
try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (e) { /* ignore */ }
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'gis-test-secret';

function dbFile(name) {
    const rel = `data/${name}-${process.pid}.db`;
    return { rel, abs: path.join(ROOT, rel) };
}

function removeDb(abs) {
    for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) {
        try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
    }
}

function open(abs) {
    return new sqlite3.Database(abs);
}

function exec(conn, sql) {
    return new Promise((resolve, reject) => conn.exec(sql, (e) => (e ? reject(e) : resolve())));
}
function run(conn, sql, params = []) {
    return new Promise((resolve, reject) => conn.run(sql, params, function (e) { return e ? reject(e) : resolve({ id: this.lastID, changes: this.changes }); }));
}
function close(conn) {
    return new Promise((resolve) => conn.close(() => resolve()));
}

/** 基线表（生产库已有；仅用于让权限/集市/Wiki 迁移与接口有依赖可跑） */
const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    email TEXT UNIQUE,
    password TEXT NOT NULL DEFAULT '',
    avatar TEXT DEFAULT '/uploads/default-avatar.png',
    level INTEGER DEFAULT 0,
    contribution INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    email_verified INTEGER DEFAULT 0,
    openid TEXT,
    equipped_title INTEGER,
    cover TEXT DEFAULT '',
    password_set INTEGER NOT NULL DEFAULT 1,
    skin_path TEXT,
    game_id TEXT DEFAULT '',
    is_frozen INTEGER DEFAULT 0,
    last_login_ip TEXT,
    last_login_at TEXT,
    generation TEXT,
    qq TEXT
);
CREATE TABLE IF NOT EXISTS contribution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER,
    to_user INTEGER,
    amount INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS wiki_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    summary TEXT,
    content TEXT NOT NULL DEFAULT '',
    cover_image TEXT,
    author_id INTEGER NOT NULL DEFAULT 1,
    last_editor_id INTEGER,
    status TEXT DEFAULT 'published',
    is_featured INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    project_id INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    published_at TEXT
);
CREATE TABLE IF NOT EXISTS market_stores (    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    intro TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    notice TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    tags TEXT DEFAULT '[]',
    category_id INTEGER,
    rating_sum INTEGER DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    sales_count INTEGER DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    is_featured INTEGER DEFAULT 0,
    expire_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS market_store_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    server_key TEXT NOT NULL,
    server_name TEXT DEFAULT '',
    dimension TEXT NOT NULL DEFAULT 'overworld'
        CHECK (dimension IN ('overworld','nether','end','custom')),
    dimension_custom TEXT DEFAULT '',
    x REAL NOT NULL DEFAULT 0,
    y REAL DEFAULT 64,
    z REAL NOT NULL DEFAULT 0,
    label TEXT DEFAULT '',
    note TEXT DEFAULT '',
    is_public INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS market_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER, store_id INTEGER, total INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS market_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'product',
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    icon TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

/** 造基线库（含可选的集市旧数据，用于验证迁移前后数量/id/坐标不变） */
async function createBase(abs, { marketLocations = 0 } = {}) {
    const conn = open(abs);
    try {
        await exec(conn, BASE_SCHEMA);
        if (marketLocations > 0) {
            const storeId = (await run(conn, `INSERT INTO market_stores (owner_id, name, slug, status) VALUES (1, '测试店铺', 'test-store', 'active')`)).id;
            for (let i = 1; i <= marketLocations; i++) {
                await run(conn,
                    `INSERT INTO market_store_locations (store_id, server_key, server_name, dimension, x, y, z, label, note, is_public)
                     VALUES (?, ?, ?, 'overworld', ?, 64, ?, ?, ?, 1)`,
                    [storeId, i % 2 === 0 ? 'yl' : '樱梨', i % 2 === 0 ? '樱梨' : '樱梨主服', 100 + i * 7, -200 + i * 3, `旧地点${i}`, `备注${i}`]);
            }
        }
    } finally {
        await close(conn);
    }
}

/** 执行真实迁移（migrations/run.js） */
function runMigrations(rel) {
    const out = execFileSync(process.execPath, ['migrations/run.js', `--db=${rel}`], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    return out;
}

/**
 * 准备一个完整的临时库：基线表 → 迁移（权限 100-104 + GIS 120-126）。
 * @returns {{rel:string, abs:string, out:string}}
 */
async function prepare({ name = 'gis-test', marketLocations = 0 } = {}) {
    const { rel, abs } = dbFile(name);
    removeDb(abs);
    await createBase(abs, { marketLocations });
    const out = runMigrations(rel);
    process.env.DB_FILE = rel;
    return { rel, abs, out };
}

/** 迷你 express app（与 server.js 一致的 body 解析 + GIS 路由） */
async function startApp() {
    const express = require('express');
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));
    app.use('/api/gis', require('../../routes/gis'));
    app.use((req, res) => res.status(404).json({ ok: false, error: 'not_found', message: '路由不存在' }));
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        res.status(500).json({ ok: false, error: 'server_error', message: String(err && err.message) });
    });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    return {
        server,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => server.close(() => resolve()))
    };
}

/** HTTP 客户端 */
function makeClient(base) {
    async function request(method, p, { token = null, body = null, raw = null, headers = {} } = {}) {
        const h = { ...headers };
        if (token) h.Authorization = `Bearer ${token}`;
        let payload;
        if (raw) { payload = raw; }
        else if (body !== undefined && body !== null) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
        const res = await fetch(`${base}${p}`, { method, headers: h, body: payload });
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
        return { status: res.status, json, headers: res.headers };
    }
    return {
        request,
        get: (p, opts) => request('GET', p, opts),
        post: (p, body, opts = {}) => request('POST', p, { ...opts, body }),
        put: (p, body, opts = {}) => request('PUT', p, { ...opts, body }),
        del: (p, opts) => request('DELETE', p, opts)
    };
}

/* ---------------- 用户 / token ---------------- */

async function createUser({ username, level = 0, gameId = 'test_player', contribution = 0, frozen = 0 }) {
    const db = require('../../database');
    const r = await db.run(
        `INSERT INTO users (username, nickname, email, password, level, contribution, game_id, is_frozen)
         VALUES (?, ?, ?, 'x', ?, ?, ?, ?)`,
        [username, username, `${username}@test.local`, level, contribution, gameId, frozen]
    );
    return { id: r.id, username, level };
}

function tokenFor(user) {
    return jwt.sign({ userId: user.id, username: user.username, level: user.level }, process.env.JWT_SECRET, { expiresIn: '2h' });
}

/* ---------------- 数据构造 ---------------- */

async function seedServerAndWorld({ serverKey = 'yl', serverName = '樱梨', worldKey = null, status = 'ACTIVE' } = {}) {
    const worlds = require('../../lib/gis/worlds');
    const server = await worlds.registerServer({ serverKey, serverName, mcVersion: '1.21.11' });
    const world = await worlds.registerWorld({
        worldKey: worldKey || `${serverKey}-test-main`, serverKey, serverName, mcVersion: '1.21.11', status
    });
    await worlds.updateWorld(world.id, { isCurrent: true });
    return { server, world };
}

/** 构造一个 chunk 的高度矩阵（正弦地形，真实可验证） */
function heightMatrix({ sampleStep = 1, base = 64, amp = 12, seed = 0 } = {}) {
    const size = 16 / sampleStep;
    const out = new Array(size * size);
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            const wx = x * sampleStep + seed;
            const wz = z * sampleStep + seed;
            out[z * size + x] = Math.round(base + amp * Math.sin((wx + wz) / 9) + amp * Math.cos(wx / 13));
        }
    }
    return { heights: out, sampleStep, sampleSize: size };
}

/** 构造 v1 二进制上传载荷（与 docs/gis-api.md 一致） */
function buildBatchBuffer({ worldId, dimension = 'overworld', chunks }) {
    const terrain = require('../../lib/gis/terrain');
    return terrain.encodeBatch({ worldId, dimension, chunks });
}

function zstd(buf) { return require('zlib').zstdCompressSync(buf); }
function gzip(buf) { return require('zlib').gzipSync(buf); }

/* ---------------- 断言 / 运行器 ---------------- */

function makeRunner(title) {
    const results = [];
    let current = null;
    return {
        async test(name, fn) {
            current = { name, ok: false, error: null };
            const t0 = Date.now();
            try {
                await fn();
                current.ok = true;
                current.ms = Date.now() - t0;
                console.log(`  ✅ ${name} (${current.ms}ms)`);
            } catch (e) {
                current.error = e;
                current.ms = Date.now() - t0;
                console.log(`  ❌ ${name}: ${e && e.message}`);
                if (e && e.stack) console.log(e.stack.split('\n').slice(1, 5).join('\n'));
            }
            results.push(current);
            return current.ok;
        },
        summary() {
            const pass = results.filter((r) => r.ok).length;
            const fail = results.length - pass;
            console.log(`\n${title}: ${pass} 通过 / ${fail} 失败 / 共 ${results.length}`);
            if (fail) {
                console.log('失败用例：');
                for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.error && r.error.message}`);
            }
            return fail === 0;
        }
    };
}

/** 常用断言快捷方式 */
const expect = {
    status(res, code, label = '') {
        assert.strictEqual(res.status, code, `${label} 期望 HTTP ${code}，实际 ${res.status}：${JSON.stringify(res.json).slice(0, 300)}`);
    },
    ok(res, label = '') {
        expect.status(res, 200, label);
        assert.strictEqual(res.json && res.json.ok, true, `${label} 期望 ok:true，实际 ${JSON.stringify(res.json).slice(0, 300)}`);
    },
    error(res, code, httpStatus = null, label = '') {
        if (httpStatus) expect.status(res, httpStatus, label);
        assert.strictEqual(res.json && res.json.error, code, `${label} 期望 error=${code}，实际 ${JSON.stringify(res.json).slice(0, 300)}`);
    },
    present(v, label = '') {
        assert.ok(v !== undefined && v !== null, `${label} 期望存在`);
    }
};

module.exports = {
    ROOT, prepare, runMigrations, createBase, startApp, makeClient,
    createUser, tokenFor, seedServerAndWorld, heightMatrix, buildBatchBuffer, zstd, gzip,
    makeRunner, expect, dbFile, removeDb
};
