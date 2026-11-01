#!/usr/bin/env node
/**
 * 「后台 · 每只股票的玩家持仓列表」接口自测
 *
 * 覆盖：
 *   1) GET /api/express-index/holdings/summary        三板块持有人数/总股数/总市值 + 跨板块合计
 *   2) GET /api/express-index/stocks/:id/holdings     明细（按股数降序、分页、空持仓排除、字段/敏感信息）
 *   3) 权限：未登录 401 / 普通成员 403 / 管理员 200（level 实时读库，不信 token 里的 level）
 *   4) 参数：非法 stockId 400 / 不存在 404 / pageSize 上限 200 / limit 别名
 *   5) 回归：lib.holdings()（我的持仓）返回结构不变，且与管理员明细口径一致；/quotes 公开接口不变
 *
 * 安全：全程使用临时 SQLite 库，绝不连接生产库
 *   - 未传 DB_FILE 时默认 data/express-holdings-test.db（每次重建）
 *   - 显式拒绝在 guild*.db / 含 "prod" 的库上运行
 *   - JWT_SECRET 未设置时用本地测试串，本脚本不加载 .env
 *
 * 用法：
 *   node scripts/test-express-holdings-admin.js
 *   DB_FILE=data/xxx-test.db node scripts/test-express-holdings-admin.js
 *
 * 退出码：0 = 全部断言通过；1 = 有失败
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------- 1. 先锁定临时库，再加载 database / 路由（DB_FILE 必须在 require 前设置） ---------- */
const DEFAULT_DB = path.join(ROOT, 'data', 'express-holdings-test.db');
const dbFile = process.env.DB_FILE ? path.resolve(ROOT, process.env.DB_FILE) : DEFAULT_DB;
const base = path.basename(dbFile).toLowerCase();
if (/^guild.*\.db/.test(base) || base.includes('prod')) {
    console.error('✗ 拒绝在疑似生产库上运行测试：' + dbFile);
    process.exit(1);
}
process.env.DB_FILE = dbFile;
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'express-holdings-local-test-secret';
const TEST_SECRET = process.env.JWT_SECRET;

// 重建临时库（含 -wal / -shm）
for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* 忽略 */ }
}
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const express = require('express');
const jwt = require('jsonwebtoken');
const db = require(path.join(ROOT, 'database'));
const expressIndex = require(path.join(ROOT, 'lib', 'express-index'));
const expressIndexRoutes = require(path.join(ROOT, 'routes', 'express-index'));

let pass = 0;
const failures = [];
function check(name, cond, extra = '') {
    if (cond) { pass++; console.log(`  [ok]   ${name}${extra ? '  « ' + extra + ' »' : ''}`); }
    else { failures.push(name); console.log(`  [FAIL] ${name}${extra ? '  « ' + extra + ' »' : ''}`); }
}
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) < eps;

/* ---------- 2. 造表 + 造数据 ---------- */
const STOCK_HEAVY = { id: 15, symbol: 'XJ-HEAVY', name: '玄剑重工', price: 12.5 };
const STOCK_BUILD = { id: 16, symbol: 'XJ-BUILD', name: '玄剑建工', price: 8.25 };
const STOCK_LABOR = { id: 17, symbol: 'XJ-LABOR', name: '玄剑人力', price: 5.5 };

async function createSchema() {
    await db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        nickname TEXT NOT NULL,
        email TEXT,
        password TEXT,
        avatar TEXT DEFAULT '/uploads/default-avatar.png',
        level INTEGER DEFAULT 0,
        contribution REAL DEFAULT 0,
        openid TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run(`CREATE TABLE stocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        current_price REAL NOT NULL DEFAULT 5,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run(`CREATE TABLE stock_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stock_id INTEGER NOT NULL,
        shares INTEGER NOT NULL DEFAULT 0,
        cost_basis REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, stock_id)
    )`);
    await db.run(`CREATE TABLE stock_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id INTEGER NOT NULL,
        price REAL NOT NULL,
        volume INTEGER DEFAULT 0,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run(`CREATE TABLE stock_daily_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        open_price REAL,
        close_price REAL,
        delta_sum REAL DEFAULT 0,
        trade_count INTEGER DEFAULT 0,
        UNIQUE (stock_id, day)
    )`);
    await db.run(`CREATE TABLE settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
}

async function addUser(id, username, nickname, level) {
    await db.run(
        `INSERT INTO users (id, username, nickname, email, password, level, contribution, openid)
         VALUES (?, ?, ?, ?, 'not-a-real-hash', ?, 1000, ?)`,
        [id, username, nickname, `secret-${id}@example.invalid`, level, `openid-secret-${id}`]
    );
}

async function seed() {
    await db.run('INSERT INTO stocks (id, symbol, name, description, current_price) VALUES (?, ?, ?, ?, ?)',
        [STOCK_HEAVY.id, STOCK_HEAVY.symbol, STOCK_HEAVY.name, '重工板块', STOCK_HEAVY.price]);
    await db.run('INSERT INTO stocks (id, symbol, name, description, current_price) VALUES (?, ?, ?, ?, ?)',
        [STOCK_BUILD.id, STOCK_BUILD.symbol, STOCK_BUILD.name, '建工板块', STOCK_BUILD.price]);
    await db.run('INSERT INTO stocks (id, symbol, name, description, current_price) VALUES (?, ?, ?, ?, ?)',
        [STOCK_LABOR.id, STOCK_LABOR.symbol, STOCK_LABOR.name, '人力板块', STOCK_LABOR.price]);
    await db.run(`INSERT INTO stock_daily_snapshots (stock_id, day, open_price, close_price) VALUES (?, '2026-10-01', 12, 12)`, [STOCK_HEAVY.id]);
    await db.run(`INSERT INTO stock_daily_snapshots (stock_id, day, open_price, close_price) VALUES (?, '2026-10-01', 8, 8)`, [STOCK_BUILD.id]);
    await db.run(`INSERT INTO stock_daily_snapshots (stock_id, day, open_price, close_price) VALUES (?, '2026-10-01', 5, 5)`, [STOCK_LABOR.id]);
    await db.run(`INSERT INTO settings (key, value) VALUES ('express.floorPrice', '5')`);

    // 管理员（DB level=2，但签发的 token 里故意写 level=0，用于验证「实时读库」）
    await addUser(1, 'hold_admin', '持仓管理员', 2);
    // 普通成员
    await addUser(2, 'hold_member', '普通成员', 0);

    // 重工：60 位持有人，股数 99..40（降序断言用），成本均价 10
    for (let i = 0; i < 60; i++) {
        const uid = 101 + i;
        const shares = 99 - i;
        await addUser(uid, `hold_u${String(i + 1).padStart(2, '0')}`, `持仓玩家${String(i + 1).padStart(2, '0')}`, 0);
        await db.run(
            `INSERT INTO stock_holdings (user_id, stock_id, shares, cost_basis, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
            [uid, STOCK_HEAVY.id, shares, shares * 10, i === 0 ? '2026-10-01 08:30:00' : '2026-10-01 09:00:00']
        );
    }
    // 空仓记录：shares=0 且 cost_basis 残留非 0 → 必须被排除（持有人数应仍是 60）
    await addUser(161, 'hold_empty', '空仓玩家', 0);
    await db.run(
        `INSERT INTO stock_holdings (user_id, stock_id, shares, cost_basis) VALUES (?, ?, 0, 1234.56)`,
        [161, STOCK_HEAVY.id]
    );

    // 建工：u101（与重工重叠，用于验证「合计持有人按用户去重」）+ u162；合计 40 股 / 成本 380 / 市值 330
    await addUser(162, 'hold_build', '建工玩家', 0);
    await db.run(`INSERT INTO stock_holdings (user_id, stock_id, shares, cost_basis) VALUES (101, ?, 10, 80)`, [STOCK_BUILD.id]);
    await db.run(`INSERT INTO stock_holdings (user_id, stock_id, shares, cost_basis) VALUES (162, ?, 30, 300)`, [STOCK_BUILD.id]);

    // 人力：u163 + u164；合计 10 股 / 成本 50 / 市值 55
    await addUser(163, 'hold_labor1', '人力玩家甲', 0);
    await addUser(164, 'hold_labor2', '人力玩家乙', 0);
    await db.run(`INSERT INTO stock_holdings (user_id, stock_id, shares, cost_basis) VALUES (163, ?, 7, 35)`, [STOCK_LABOR.id]);
    await db.run(`INSERT INTO stock_holdings (user_id, stock_id, shares, cost_basis) VALUES (164, ?, 3, 15)`, [STOCK_LABOR.id]);
}

/* ---------- 3. 起一个只挂该路由的最小服务（局部联调，不起全站） ---------- */
let server;
let BASE;
async function startServer() {
    const app = express();
    app.use(express.json());
    app.use('/api/express-index', expressIndexRoutes);
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    BASE = `http://127.0.0.1:${server.address().port}`;
}

const tok = (userId, level = 0) => jwt.sign({ userId, level }, TEST_SECRET);
async function api(method, url, userId, level = 0) {
    const headers = {};
    if (userId) headers.Authorization = 'Bearer ' + tok(userId, level);
    const res = await fetch(BASE + url, { method, headers });
    let json = null;
    try { json = await res.json(); } catch (e) { /* 非 JSON */ }
    return { status: res.status, json, text: JSON.stringify(json) };
}

/* ---------- 4. 断言 ---------- */
(async () => {
    console.log('临时库：' + dbFile);
    console.log('（JWT_SECRET 使用本地测试串，未读取 .env）\n');

    await createSchema();
    await seed();
    await startServer();
    console.log('局部服务：' + BASE + '\n');

    /* --- 4.1 概览：三板块 + 去重合计 --- */
    console.log('=== 1) GET /holdings/summary（管理员） ===');
    const sum = await api('GET', '/api/express-index/holdings/summary', 1, 0);
    check('管理员可读（DB level=2，token 里 level=0 也放行 → 实时读库）', sum.status === 200, 'HTTP ' + sum.status);
    const s15 = (sum.json.stocks || []).find((s) => s.stockId === 15);
    const s16 = (sum.json.stocks || []).find((s) => s.stockId === 16);
    const s17 = (sum.json.stocks || []).find((s) => s.stockId === 17);
    check('返回 3 只板块', (sum.json.stocks || []).length === 3);
    check('重工：持有人 60 人、总股数 4170、总市值 52125',
        s15 && s15.holders === 60 && s15.totalShares === 4170 && near(s15.totalMarketValue, 52125),
        s15 && `holders=${s15.holders} shares=${s15.totalShares} mv=${s15.totalMarketValue}`);
    check('建工：持有人 2 人、总股数 40、总市值 330',
        s16 && s16.holders === 2 && s16.totalShares === 40 && near(s16.totalMarketValue, 330),
        s16 && `holders=${s16.holders} shares=${s16.totalShares} mv=${s16.totalMarketValue}`);
    check('人力：持有人 2 人、总股数 10、总市值 55',
        s17 && s17.holders === 2 && s17.totalShares === 10 && near(s17.totalMarketValue, 55),
        s17 && `holders=${s17.holders} shares=${s17.totalShares} mv=${s17.totalMarketValue}`);
    check('合计持有人按用户去重 = 63（101~160 + 162~164；空仓 161 不计）',
        sum.json.total && sum.json.total.holders === 63, sum.json.total && 'holders=' + sum.json.total.holders);
    check('合计股数 4220 / 合计市值 52510 / 合计浮动盈亏 10380',
        near(sum.json.total.totalShares, 4220) && near(sum.json.total.totalMarketValue, 52510) &&
        near(sum.json.total.totalProfit, 10380),
        JSON.stringify(sum.json.total));

    /* --- 4.2 明细：排序、分页、汇总、字段 --- */
    console.log('\n=== 2) GET /stocks/15/holdings（分页 + 排序 + 汇总） ===');
    const p1 = await api('GET', '/api/express-index/stocks/15/holdings?page=1&pageSize=50', 1, 0);
    check('管理员可读', p1.status === 200, 'HTTP ' + p1.status);
    check('股票信息：名称/代码/现价', p1.json.stock && p1.json.stock.name === '玄剑重工' &&
        p1.json.stock.symbol === 'XJ-HEAVY' && near(p1.json.stock.price, 12.5), JSON.stringify(p1.json.stock));
    check('汇总：holders=60 totalShares=4170 totalCost=41700 totalMV=52125 totalProfit=10425 profitPct=25',
        p1.json.summary.holders === 60 && p1.json.summary.totalShares === 4170 &&
        near(p1.json.summary.totalCost, 41700) && near(p1.json.summary.totalMarketValue, 52125) &&
        near(p1.json.summary.totalProfit, 10425) && near(p1.json.summary.profitPct, 25),
        JSON.stringify(p1.json.summary));
    check('分页元信息：page=1 pageSize=50 total=60 totalPages=2',
        p1.json.pagination.page === 1 && p1.json.pagination.pageSize === 50 &&
        p1.json.pagination.total === 60 && p1.json.pagination.totalPages === 2,
        JSON.stringify(p1.json.pagination));
    check('第 1 页返回 50 条', p1.json.items.length === 50, 'items=' + p1.json.items.length);
    check('按股数降序：首条 99 股、第 50 条 50 股',
        p1.json.items[0].shares === 99 && p1.json.items[49].shares === 50,
        `first=${p1.json.items[0].shares} last=${p1.json.items[49].shares}`);
    const desc = p1.json.items.every((it, i, arr) => i === 0 || arr[i - 1].shares >= it.shares);
    check('整页股数单调不增', desc);
    const it0 = p1.json.items[0];
    check('明细字段齐全（userId/username/nickname/shares/costBasis/avgCost/price/marketValue/profit/profitPct/updatedAt）',
        ['userId', 'username', 'nickname', 'shares', 'costBasis', 'avgCost', 'price', 'marketValue', 'profit', 'profitPct', 'updatedAt']
            .every((k) => it0[k] !== undefined),
        Object.keys(it0).join(','));
    check('首条数值：均价 10 / 现价 12.5 / 市值 1237.5 / 浮盈 247.5 / 盈亏率 25%',
        near(it0.avgCost, 10) && near(it0.price, 12.5) && near(it0.marketValue, 1237.5) &&
        near(it0.profit, 247.5) && near(it0.profitPct, 25),
        `avgCost=${it0.avgCost} price=${it0.price} mv=${it0.marketValue} profit=${it0.profit} pct=${it0.profitPct}`);
    check('首条成员信息：持仓玩家01 / hold_u01 / 更新时间 2026-10-01 08:30:00',
        it0.nickname === '持仓玩家01' && it0.username === 'hold_u01' && it0.updatedAt === '2026-10-01 08:30:00',
        `${it0.nickname} @${it0.username} ${it0.updatedAt}`);
    check('响应不含 email / openid / ip 等敏感字段',
        !('email' in it0) && !('openid' in it0) && !('ip' in it0) &&
        !p1.text.includes('secret-') && !p1.text.includes('openid-secret'),
        '无 secret-* / openid-* 字样');

    const p2 = await api('GET', '/api/express-index/stocks/15/holdings?page=2&pageSize=50', 1, 0);
    check('第 2 页返回 10 条（60 - 50）', p2.json.items.length === 10, 'items=' + p2.json.items.length);
    check('第 2 页首尾：49 股 → 40 股',
        p2.json.items[0].shares === 49 && p2.json.items[9].shares === 40,
        `${p2.json.items[0].shares} → ${p2.json.items[9].shares}`);
    check('第 2 页与第 1 页无重复用户',
        new Set([...p1.json.items, ...p2.json.items].map((i) => i.userId)).size === 60);

    const p3 = await api('GET', '/api/express-index/stocks/15/holdings?page=3&pageSize=50', 1, 0);
    check('越界页：返回空数组但 pagination 仍报 total=60', p3.status === 200 && p3.json.items.length === 0 &&
        p3.json.pagination.total === 60, `HTTP ${p3.status} items=${p3.json.items.length}`);

    check('空持仓（shares=0）被排除：全量 60 条里没有 userId=161',
        ![...p1.json.items, ...p2.json.items].some((i) => i.userId === 161));
    const capped = await api('GET', '/api/express-index/stocks/15/holdings?page=1&pageSize=999', 1, 0);
    check('pageSize 上限 200（请求 999 → 200）', capped.json.pagination.pageSize === 200,
        'pageSize=' + capped.json.pagination.pageSize);
    const lim = await api('GET', '/api/express-index/stocks/15/holdings?page=1&limit=5', 1, 0);
    check('limit 作为 pageSize 别名（limit=5 → 5 条）',
        lim.json.pagination.pageSize === 5 && lim.json.items.length === 5,
        `pageSize=${lim.json.pagination.pageSize} items=${lim.json.items.length}`);
    const weird = await api('GET', '/api/express-index/stocks/15/holdings?page=1%20OR%201=1&pageSize=abc', 1, 0);
    check('非法分页参数回落到默认值（page=1 / pageSize=50）且不报 500',
        weird.status === 200 && weird.json.pagination.page === 1 && weird.json.pagination.pageSize === 50,
        `HTTP ${weird.status} page=${weird.json.pagination.page} size=${weird.json.pagination.pageSize}`);

    const empty = await api('GET', '/api/express-index/stocks/16/holdings', 1, 0);
    check('有持仓的建工：2 条、合计与概览一致',
        empty.json.items.length === 2 && empty.json.summary.totalShares === 40 &&
        near(empty.json.summary.totalMarketValue, 330), JSON.stringify(empty.json.summary));

    /* --- 4.3 权限与参数校验 --- */
    console.log('\n=== 3) 权限 / 参数校验 ===');
    const anon1 = await api('GET', '/api/express-index/holdings/summary');
    check('未登录（无 token）读概览 → 401', anon1.status === 401, 'HTTP ' + anon1.status);
    const anon2 = await api('GET', '/api/express-index/stocks/15/holdings');
    check('未登录（无 token）读明细 → 401', anon2.status === 401, 'HTTP ' + anon2.status);
    const member1 = await api('GET', '/api/express-index/holdings/summary', 2, 0);
    check('普通成员（level 0）读概览 → 403', member1.status === 403, 'HTTP ' + member1.status);
    const member2 = await api('GET', '/api/express-index/stocks/15/holdings', 2, 0);
    check('普通成员（level 0）读明细 → 403', member2.status === 403, 'HTTP ' + member2.status);
    const fakeAdmin = await api('GET', '/api/express-index/holdings/summary', 2, 2);
    check('token 伪造 level=2 但 DB level=0 → 仍 403（实时读库）', fakeAdmin.status === 403, 'HTTP ' + fakeAdmin.status);
    const badId = await api('GET', '/api/express-index/stocks/abc/holdings', 1, 0);
    check('非法 stockId（abc）→ 400', badId.status === 400, 'HTTP ' + badId.status + ' ' + (badId.json && badId.json.error));
    const notFound = await api('GET', '/api/express-index/stocks/9999/holdings', 1, 0);
    check('不存在的 stockId → 404', notFound.status === 404, 'HTTP ' + notFound.status + ' ' + (notFound.json && notFound.json.error));

    /* --- 4.4 回归：我的持仓 + 公开行情 --- */
    console.log('\n=== 4) 回归：lib.holdings() 与 /quotes 未被改动 ===');
    const mine = await expressIndex.holdings(101);
    check('我的持仓：2 条（重工 99 股 + 建工 10 股）', mine.items.length === 2,
        mine.items.map((i) => i.stockId + ':' + i.shares).join(','));
    check('我的持仓 items 键名与顺序不变',
        JSON.stringify(Object.keys(mine.items[0])) ===
        JSON.stringify(['stockId', 'name', 'symbol', 'shares', 'avgCost', 'price', 'marketValue', 'cost', 'profit', 'profitPct']),
        Object.keys(mine.items[0]).join(','));
    check('我的持仓 summary 键名不变（marketValue/cost/profit/profitPct/cash/totalAssets/netProfit）',
        JSON.stringify(Object.keys(mine.summary)) ===
        JSON.stringify(['marketValue', 'cost', 'profit', 'profitPct', 'cash', 'totalAssets', 'netProfit']),
        Object.keys(mine.summary).join(','));
    check('我的持仓数值：市值 1320 / 成本 1070 / 浮盈 250',
        near(mine.summary.marketValue, 1320) && near(mine.summary.cost, 1070) && near(mine.summary.profit, 250),
        JSON.stringify(mine.summary));
    const adminRow = p1.json.items.find((i) => i.userId === 101);
    check('管理员明细与我的持仓口径一致（同一用户同一股票：市值 1237.5 / 浮盈 247.5）',
        adminRow && near(adminRow.marketValue, 1237.5) && near(adminRow.profit, 247.5),
        adminRow ? `mv=${adminRow.marketValue} profit=${adminRow.profit}` : '未找到 userId=101');

    const q = await api('GET', '/api/express-index/quotes');
    check('公开 /quotes 正常（3 只、字段不变）',
        q.status === 200 && q.json.stocks.length === 3 &&
        ['id', 'symbol', 'name', 'price', 'yesterdayClose', 'change', 'changePct', 'floorPrice', 'canBuy', 'floored']
            .every((k) => q.json.stocks[0][k] !== undefined),
        `HTTP ${q.status} price=${q.json.stocks[0].price} 昨收=${q.json.stocks[0].yesterdayClose}`);

    /* --- 4.5 打印一份示例响应，作为接口文档证据 --- */
    console.log('\n=== 5) 响应示例（缩略） ===');
    const sample = {
        ok: true,
        stock: p1.json.stock,
        summary: p1.json.summary,
        items: p1.json.items.slice(0, 2),
        pagination: p1.json.pagination
    };
    console.log(JSON.stringify(sample, null, 2));
    console.log('\n概览示例：');
    console.log(JSON.stringify({ ok: true, stocks: sum.json.stocks, total: sum.json.total }, null, 2));

    /* ---------- 收尾 ---------- */
    server.close();
    db.close();
    await new Promise((r) => setTimeout(r, 120));
    for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* 忽略 */ }
    }

    console.log(`\n===== 结果：通过 ${pass} 项，失败 ${failures.length} 项 =====`);
    if (failures.length) {
        console.log('失败项：\n - ' + failures.join('\n - '));
        process.exit(1);
    }
    console.log('临时库已清理：' + dbFile);
    process.exit(0);
})().catch((e) => {
    console.error('\n测试脚本异常：' + (e && e.stack ? e.stack : e));
    try { if (server) server.close(); } catch (err) { /* 忽略 */ }
    try { db.close(); } catch (err) { /* 忽略 */ }
    process.exit(1);
});
