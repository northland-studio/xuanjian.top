/**
 * 玄剑 Wiki 审计（exam.xuanjian.top）
 *
 * 最小化实现：
 *  - 独立服务 + 本地 SQLite（exam.db）存审计状态与每日任务
 *  - 直连官网 SQLite（guild.db，只读）读取 wiki 全部信息
 *  - OAuth2 授权码登录（client_id=wiki-exam，向 xuanjian.top 取授权）
 *  - 仅 Level >= 1 可登录；每个页面只审计一次（审计后不再分配）
 *  - 每天首次访问自动分配 10 条未审计页面作为「今日任务」，审计数量本身不限制
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

/** 加载 .env（pm2 启动时不会自动读取；dotenv 复用官网 node_modules） */
try {
    require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
} catch (e) {
    console.warn('[exam] dotenv 不可用，使用进程环境变量:', e.message);
}

const crypto = require('node:crypto');
const express = require('express');
const sqlite3 = require('sqlite3');

const ROOT = __dirname;
const DATA_DIR = process.env.EXAM_DATA_DIR || path.join(ROOT, 'data');
const EXAM_DB_FILE = process.env.EXAM_DB || path.join(DATA_DIR, 'exam.db');
const GUILD_DB_FILE = process.env.GUILD_DB || '/var/www/xuanjian-guild/data/guild.db';
const PORT = Number(process.env.PORT || 3903);
const SITE_URL = (process.env.SITE_URL || 'https://exam.xuanjian.top').replace(/\/$/, '');
const OAUTH = {
    provider: (process.env.OAUTH_PROVIDER || 'https://xuanjian.top').replace(/\/$/, ''),
    clientId: process.env.OAUTH_CLIENT_ID || 'wiki-exam',
    clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
    redirectUri: process.env.OAUTH_REDIRECT_URI || SITE_URL + '/callback/oauth'
};
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DAILY_TASK_COUNT = Number(process.env.DAILY_TASK_COUNT || 10);
const SESSION_COOKIE = 'exam_session';
const STATE_COOKIE = 'exam_oauth_state';

/* ---------------- SQLite 封装 ---------------- */
function openDb(file, mode) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, mode || sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => (err ? reject(err) : resolve(db)));
    });
}
const all = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => (e ? reject(e) : resolve(rows))));
const get = (db, sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (e, row) => (e ? reject(e) : resolve(row))));
const run = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (e) { e ? reject(e) : resolve({ changes: this.changes, lastID: this.lastID }); }));

let examDb; // 读写
let guildDb; // 只读
let guildOnline = false;

async function initDb() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    examDb = await openDb(EXAM_DB_FILE);
    await run(examDb, 'PRAGMA journal_mode=WAL');
    await run(examDb, `CREATE TABLE IF NOT EXISTS audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id INTEGER NOT NULL UNIQUE,
        page_title TEXT NOT NULL,
        page_slug TEXT NOT NULL,
        auditor_id INTEGER NOT NULL,
        auditor_name TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT 'pass',
        note TEXT NOT NULL DEFAULT '',
        page_updated_at TEXT,
        created_at TEXT NOT NULL
    )`);
    await run(examDb, `CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        task_date TEXT NOT NULL,
        page_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, task_date, page_id)
    )`);
    await run(examDb, 'CREATE INDEX IF NOT EXISTS idx_audits_auditor ON audits(auditor_id)');
    await run(examDb, 'CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, task_date)');

    try {
        guildDb = await openDb(GUILD_DB_FILE, sqlite3.OPEN_READONLY);
        guildOnline = true;
    } catch (e) {
        guildOnline = false;
        console.error('[exam] 无法打开 guild.db（只读）:', e.message);
    }
}

/* ---------------- 工具 ---------------- */
const nowText = () => new Date().toLocaleString('sv-SE').replace('T', ' ');
const today = () => new Date().toLocaleDateString('sv-SE');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest();

function signSession(payload) {
    const body = b64url(JSON.stringify(payload));
    return body + '.' + b64url(hmac(body));
}
function readSession(cookieHeader, name) {
    if (!cookieHeader) return null;
    const m = cookieHeader.split(';').map((x) => x.trim()).find((x) => x.startsWith(name + '='));
    if (!m) return null;
    const raw = decodeURIComponent(m.slice(name.length + 1));
    const [body, sig] = raw.split('.');
    if (!body || !sig) return null;
    const expect = b64url(hmac(body));
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
}
const parseCookies = (h) => Object.fromEntries(String(h || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf('=');
    return i < 0 ? [x, ''] : [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
}));

const STATUS_LABEL = { published: '已发布', draft: '草稿', review: '待审核', rejected: '已驳回', archived: '已归档' };
const RESULT_LABEL = { pass: '通过', issue: '有问题' };

/* ---------------- wiki 查询（只读 guild.db） ---------------- */
async function wikiStats() {
    const total = await get(guildDb, 'SELECT COUNT(*) AS c FROM wiki_pages');
    const archived = await get(guildDb, "SELECT COUNT(*) AS c FROM wiki_pages WHERE status='archived'");
    const audited = await get(examDb, 'SELECT COUNT(*) AS c FROM audits');
    return { total: total.c, archived: archived.c, audited: audited.c, pending: Math.max(0, total.c - audited.c) };
}

async function wikiPageList({ q, categoryId, status, audited, limit = 30, offset = 0 }) {
    const where = [];
    const params = [];
    if (q) { where.push('p.title LIKE ?'); params.push('%' + q + '%'); }
    if (categoryId) { where.push('p.category_id = ?'); params.push(Number(categoryId)); }
    if (status) { where.push('p.status = ?'); params.push(status); }
    const base = `FROM wiki_pages p LEFT JOIN wiki_categories c ON c.id = p.category_id LEFT JOIN users u ON u.id = p.author_id`;
    let rows = await all(guildDb, `SELECT p.id, p.title, p.slug, p.status, p.category_id, c.name AS category_name, p.author_id, u.nickname AS author_name,
            p.created_at, p.updated_at, p.published_at, p.views, LENGTH(p.content) AS content_len
        ${base} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, [...params, limit + 1, offset]);
    const totalRow = await get(guildDb, `SELECT COUNT(*) AS c FROM wiki_pages p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params);
    const auditRows = await all(examDb, 'SELECT page_id, auditor_id, auditor_name, result, created_at FROM audits');
    const auditMap = new Map(auditRows.map((a) => [a.page_id, a]));
    rows = rows.map((r) => ({ ...r, audit: auditMap.get(r.id) || null }));
    if (audited === 'yes') rows = rows.filter((r) => r.audit);
    if (audited === 'no') rows = rows.filter((r) => !r.audit);
    return { rows, total: totalRow.c };
}

async function wikiPageDetail(id) {
    const page = await get(guildDb, `SELECT p.*, c.name AS category_name, u.nickname AS author_name, e.nickname AS editor_name
        FROM wiki_pages p LEFT JOIN wiki_categories c ON c.id = p.category_id
        LEFT JOIN users u ON u.id = p.author_id LEFT JOIN users e ON e.id = p.last_editor_id WHERE p.id = ?`, [id]);
    if (!page) return null;
    const revisions = await all(guildDb, `SELECT r.id, r.title, r.summary, r.revision_note, r.created_at, u.nickname AS editor_name
        FROM wiki_revisions r LEFT JOIN users u ON u.id = r.editor_id WHERE r.page_id = ? ORDER BY r.id DESC LIMIT 20`, [id]);
    const audit = await get(examDb, 'SELECT * FROM audits WHERE page_id = ?', [id]);
    return { page, revisions, audit };
}

async function ensureDailyTasks(userId) {
    const day = today();
    const existing = await all(examDb, 'SELECT page_id FROM tasks WHERE user_id = ? AND task_date = ? ORDER BY id', [userId, day]);
    const have = new Set(existing.map((x) => x.page_id));
    const need = Math.max(0, DAILY_TASK_COUNT - existing.length);
    if (need > 0 && guildOnline) {
        // 注意：audits 在 examDb，wiki_pages 在 guildDb（只读），不能跨库 JOIN，先取全集再在内存过滤
        const auditedRows = await all(examDb, 'SELECT page_id FROM audits');
        const audited = new Set(auditedRows.map((x) => x.page_id));
        const candidates = await all(guildDb, 'SELECT id FROM wiki_pages ORDER BY updated_at ASC LIMIT ?', [need + existing.length + 200]);
        const picked = candidates.map((r) => r.id)
            .filter((id) => !have.has(id) && !audited.has(id))
            .slice(0, need);
        for (const pid of picked) {
            await run(examDb, 'INSERT OR IGNORE INTO tasks (user_id, task_date, page_id, created_at) VALUES (?,?,?,?)', [userId, day, pid, nowText()]);
        }
    }
    return all(examDb, 'SELECT t.page_id, t.task_date, a.page_id AS audited_page FROM tasks t LEFT JOIN audits a ON a.page_id = t.page_id WHERE t.user_id = ? AND t.task_date = ? ORDER BY t.id', [userId, day]);
}

async function tasksWithInfo(userId) {
    const tasks = await ensureDailyTasks(userId);
    const ids = tasks.map((t) => t.page_id);
    if (!ids.length) return [];
    const pages = await all(guildDb, `SELECT p.id, p.title, p.status, p.updated_at, c.name AS category_name, u.nickname AS author_name
        FROM wiki_pages p LEFT JOIN wiki_categories c ON c.id = p.category_id LEFT JOIN users u ON u.id = p.author_id
        WHERE p.id IN (${ids.map(() => '?').join(',')})`, ids);
    const map = new Map(pages.map((p) => [p.id, p]));
    return ids.map((id) => ({ page: map.get(id) || { id, title: '(页面已删除)' }, done: !!tasks.find((t) => t.page_id === id && t.audited_page) }));
}

/* ---------------- 布局与页面 ---------------- */
function layout({ title, user, active, body, csrf }) {
    const nav = [
        ['/', '工作台'],
        ['/pages', 'Wiki 全量'],
        ['/tasks', '我的任务'],
        ['/audits', '审计记录']
    ].map(([href, label]) => `<a class="nav-item ${active === href ? 'active' : ''}" href="${href}">${label}</a>`).join('');
    return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · 玄剑 Wiki 审计</title>
<link rel="stylesheet" href="/style.css">
</head><body>
<header class="topbar">
  <div class="brand"><span class="dot"></span> 玄剑 Wiki 审计 <span class="tag">exam</span></div>
  <nav class="nav">${nav}</nav>
  <div class="user">${user ? `<span class="uname">${esc(user.name)}</span><span class="lvl">LV${user.level}</span><a class="logout" href="/logout">退出</a>` : '<a class="logout" href="/login">登录</a>'}</div>
</header>
<main class="wrap">${body}</main>
<footer class="foot">数据来源：xuanjian.top · 只读；审计状态独立存储 · <span class="mono">guild.db readonly</span></footer>
<script>window.__CSRF=${JSON.stringify(csrf || '')};</script>
</body></html>`;
}

const statCard = (label, value, sub) => `<div class="card stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub || ''}</div></div>`;
const badge = (status) => `<span class="badge st-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;

function pageTable(rows, { csrf, showAudit = true } = {}) {
    if (!rows.length) return '<div class="empty">没有匹配的页面</div>';
    return `<table class="table"><thead><tr><th>#</th><th>标题</th><th>分类</th><th>状态</th><th>作者</th><th>更新时间</th><th>字数</th>${showAudit ? '<th>审计</th>' : ''}</tr></thead><tbody>
    ${rows.map((r) => `<tr>
        <td class="mono">${r.id}</td>
        <td><a href="/pages/${r.id}">${esc(r.title)}</a></td>
        <td>${esc(r.category_name || '-')}</td>
        <td>${badge(r.status)}</td>
        <td>${esc(r.author_name || '-')}</td>
        <td class="mono">${esc((r.updated_at || '').slice(0, 16))}</td>
        <td class="mono">${r.content_len || 0}</td>
        ${showAudit ? `<td>${r.audit ? `<span class="badge ok">已审计</span><span class="mini">${esc(r.audit.auditor_name)}</span>` : '<span class="badge pending">待审计</span>'}</td>` : ''}
    </tr>`).join('')}
    </tbody></table>`;
}

/* ---------------- OAuth ---------------- */
function loginUrl() {
    const state = b64url(crypto.randomBytes(16));
    const params = new URLSearchParams({
        client_id: OAUTH.clientId,
        redirect_uri: OAUTH.redirectUri,
        response_type: 'code',
        state,
        scope: 'read:user read:member'
    });
    return { url: `${OAUTH.provider}/api/oauth/authorize?${params.toString()}`, state };
}

async function exchangeCode(code) {
    const res = await fetch(`${OAUTH.provider}/api/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: OAUTH.clientId, client_secret: OAUTH.clientSecret, redirect_uri: OAUTH.redirectUri })
    });
    if (!res.ok) throw new Error('token_exchange_failed_' + res.status);
    return res.json();
}

async function fetchUser(accessToken) {
    const res = await fetch(`${OAUTH.provider}/api/oauth/verify`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error('verify_failed_' + res.status);
    const j = await res.json();
    return j && j.user ? j.user : null;
}

/* ---------------- 应用 ---------------- */
const app = express();
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
const publicDir = path.join(ROOT, 'public');
app.use('/style.css', (req, res) => {
    const f = path.join(publicDir, 'style.css');
    if (!fs.existsSync(f)) return res.status(404).end();
    res.type('text/css').send(fs.readFileSync(f, 'utf8'));
});
app.use('/page.js', (req, res) => {
    const f = path.join(publicDir, 'page.js');
    if (!fs.existsSync(f)) return res.status(404).end();
    res.type('application/javascript').send(fs.readFileSync(f, 'utf8'));
});

/** 会话：仅 LV1+ 可进入 */
function auth(req, res, next) {
    const sess = readSession(req.headers.cookie, SESSION_COOKIE);
    if (!sess || !sess.uid || sess.exp < Date.now()) {
        return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    req.user = sess;
    next();
}

app.get('/login', (req, res) => {
    const { url, state } = loginUrl();
    res.setHeader('Set-Cookie', `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    res.redirect(url);
});

app.get('/callback/oauth', async (req, res) => {
    const { code, state, error } = req.query;
    const expectState = parseCookies(req.headers.cookie)[STATE_COOKIE];
    try {
        if (error) throw new Error('oauth_error_' + error);
        if (!code || !state || state !== expectState) throw new Error('state_mismatch');
        const token = await exchangeCode(code);
        const user = await fetchUser(token.access_token);
        if (!user) throw new Error('no_user');
        const level = Number(user.level) || 0;
        if (level < 1) {
            res.status(403).send(layout({ title: '无权访问', user: null, active: '/', csrf: '', body: `<div class="card"><h2>仅 Level 1 及以上可进入</h2><p>当前账号 ${esc(user.username || '')} 等级为 LV${level}，无审计权限。</p><p><a class="btn" href="/login">换一个账号登录</a></p></div>` }));
            return;
        }
        const sess = { uid: user.id, name: user.username || user.nickname || ('用户' + user.id), level, exp: Date.now() + 7 * 86400000, csrf: b64url(crypto.randomBytes(12)) };
        res.setHeader('Set-Cookie', [
            `${SESSION_COOKIE}=${encodeURIComponent(signSession(sess))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 86400}`,
            `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
        ]);
        res.redirect('/');
    } catch (e) {
        res.status(500).send(layout({ title: '登录失败', user: null, active: '/', csrf: '', body: `<div class="card"><h2>登录失败</h2><p class="mono">${esc(e.message)}</p><p><a class="btn" href="/login">重试</a></p></div>` }));
    }
});

app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    res.redirect('/login');
});

app.get('/', auth, async (req, res, next) => {
    try {
        const stats = guildOnline ? await wikiStats() : { total: 0, archived: 0, audited: 0, pending: 0 };
        const tasks = guildOnline ? await tasksWithInfo(req.user.uid) : [];
        const done = tasks.filter((t) => t.done).length;
        const myAudits = await all(examDb, 'SELECT * FROM audits WHERE auditor_id = ? ORDER BY id DESC LIMIT 8', [req.user.uid]);
        const recent = await all(examDb, 'SELECT * FROM audits ORDER BY id DESC LIMIT 8');
        const body = `
        <div class="hero">
            <h1>工作台</h1>
            <p class="muted">欢迎，${esc(req.user.name)}。每天自动分配 ${DAILY_TASK_COUNT} 条待审计页面；审计数量不设上限，每个页面只审计一次。</p>
        </div>
        ${guildOnline ? '' : '<div class="alert">⚠ 无法读取 guild.db（只读连接失败），数据展示为空。请检查路径权限。</div>'}
        <div class="grid stats">
            ${statCard('Wiki 页面总数', stats.total, `已归档 ${stats.archived}`)}
            ${statCard('已审计', stats.audited, '每页仅审一次')}
            ${statCard('待审计', stats.pending, '剩余页面')}
            ${statCard('今日任务', `${done} / ${tasks.length}`, `每日默认 ${DAILY_TASK_COUNT} 条`)}
        </div>
        <section class="card">
            <div class="card-head"><h2>今日任务</h2><a class="link" href="/tasks">全部任务</a></div>
            ${tasks.length === 0 ? '<div class="empty">今天没有分配任务（可能所有页面都已审计）</div>' : `<ul class="task-list">
                ${tasks.map((t) => `<li class="task ${t.done ? 'done' : ''}">
                    <a href="/pages/${t.page.id}">${esc(t.page.title)}</a>
                    <span class="mini">${esc(t.page.category_name || '')}</span>
                    ${t.done ? '<span class="badge ok">已审计</span>' : '<span class="badge pending">待审计</span>'}
                </li>`).join('')}
            </ul>`}
        </section>
        <div class="grid two">
            <section class="card"><div class="card-head"><h2>我的最近审计</h2><a class="link" href="/audits">查看全部</a></div>
                ${myAudits.length ? `<ul class="audit-list">${myAudits.map((a) => `<li><a href="/pages/${a.page_id}">${esc(a.page_title)}</a><span class="mini">${esc(a.result)} · ${esc(a.created_at)}</span></li>`).join('')}</ul>` : '<div class="empty">还没有审计记录</div>'}
            </section>
            <section class="card"><div class="card-head"><h2>全站最近动态</h2></div>
                ${recent.length ? `<ul class="audit-list">${recent.map((a) => `<li><a href="/pages/${a.page_id}">${esc(a.page_title)}</a><span class="mini">${esc(a.auditor_name)} · ${esc(a.created_at)}</span></li>`).join('')}</ul>` : '<div class="empty">暂无审计记录</div>'}
            </section>
        </div>`;
        res.send(layout({ title: '工作台', user: req.user, active: '/', csrf: req.user.csrf, body }));
    } catch (e) { next(e); }
});

app.get('/tasks', auth, async (req, res, next) => {
    try {
        const tasks = guildOnline ? await tasksWithInfo(req.user.uid) : [];
        const history = await all(examDb, 'SELECT task_date, COUNT(*) AS n, SUM(CASE WHEN a.page_id IS NOT NULL THEN 1 ELSE 0 END) AS done FROM tasks t LEFT JOIN audits a ON a.page_id = t.page_id WHERE t.user_id = ? GROUP BY task_date ORDER BY task_date DESC LIMIT 30', [req.user.uid]);
        const body = `<h1>我的任务</h1>
        <section class="card"><div class="card-head"><h2>今日（${esc(today())}）</h2></div>
        ${tasks.length === 0 ? '<div class="empty">今天没有分配任务</div>' : `<ul class="task-list">${tasks.map((t) => `<li class="task ${t.done ? 'done' : ''}"><a href="/pages/${t.page.id}">${esc(t.page.title)}</a><span class="mini">${esc(t.page.category_name || '')}</span>${t.done ? '<span class="badge ok">已审计</span>' : '<span class="badge pending">待审计</span>'}</li>`).join('')}</ul>`}
        </section>
        <section class="card"><div class="card-head"><h2>历史</h2></div><table class="table"><thead><tr><th>日期</th><th>分配</th><th>完成</th></tr></thead><tbody>
        ${history.map((h) => `<tr><td class="mono">${esc(h.task_date)}</td><td>${h.n}</td><td>${h.done}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">暂无</td></tr>'}
        </tbody></table></section>`;
        res.send(layout({ title: '我的任务', user: req.user, active: '/tasks', csrf: req.user.csrf, body }));
    } catch (e) { next(e); }
});

app.get('/pages', auth, async (req, res, next) => {
    try {
        const q = String(req.query.q || '').trim();
        const categoryId = req.query.category ? Number(req.query.category) : 0;
        const status = String(req.query.status || '');
        const audited = String(req.query.audited || '');
        const pageNo = Math.max(1, Number(req.query.page) || 1);
        const limit = 30;
        let rows = [];
        let total = 0;
        let categories = [];
        if (guildOnline) {
            const out = await wikiPageList({ q, categoryId, status, audited, limit, offset: (pageNo - 1) * limit });
            rows = out.rows.slice(0, limit);
            total = out.total;
            categories = await all(guildDb, 'SELECT id, name FROM wiki_categories ORDER BY sort_order, id');
        }
        const pagesTotal = Math.max(1, Math.ceil(total / limit));
        const pager = `<div class="pager">${pageNo > 1 ? `<a href="?${new URLSearchParams({ ...req.query, page: pageNo - 1 })}">上一页</a>` : ''}<span>第 ${pageNo} / ${pagesTotal} 页 · 共 ${total} 条</span>${pageNo < pagesTotal ? `<a href="?${new URLSearchParams({ ...req.query, page: pageNo + 1 })}">下一页</a>` : ''}</div>`;
        const body = `<h1>Wiki 全量 <span class="mini">共 ${total} 页（含草稿/待审/归档）</span></h1>
        <form class="filters" method="get" action="/pages">
            <input name="q" value="${esc(q)}" placeholder="标题搜索">
            <select name="category"><option value="">全部分类</option>${categories.map((c) => `<option value="${c.id}" ${Number(categoryId) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
            <select name="status"><option value="">全部状态</option>${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <select name="audited"><option value="">审计状态</option><option value="no" ${audited === 'no' ? 'selected' : ''}>待审计</option><option value="yes" ${audited === 'yes' ? 'selected' : ''}>已审计</option></select>
            <button class="btn" type="submit">筛选</button>
        </form>
        ${pageTable(rows)}
        ${pager}`;
        res.send(layout({ title: 'Wiki 全量', user: req.user, active: '/pages', csrf: req.user.csrf, body }));
    } catch (e) { next(e); }
});

app.get('/pages/:id', auth, async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const detail = guildOnline ? await wikiPageDetail(id) : null;
        if (!detail) return res.status(404).send(layout({ title: '页面不存在', user: req.user, active: '/pages', csrf: req.user.csrf, body: '<div class="card"><h2>页面不存在</h2><a class="btn" href="/pages">返回列表</a></div>' }));
        const { page, revisions, audit } = detail;
        const body = `<div class="page-head">
            <div><h1>${esc(page.title)}</h1><div class="meta">
                <span class="mono">#${page.id}</span> ${badge(page.status)}
                <span>分类：${esc(page.category_name || '-')}</span>
                <span>作者：${esc(page.author_name || '-')}</span>
                <span>更新时间：${esc((page.updated_at || '').slice(0, 16))}</span>
                <span>浏览：${page.views || 0}</span>
                <a class="link" href="https://xuanjian.top/wiki/${encodeURIComponent(page.slug)}" target="_blank" rel="noopener">官网查看 ↗</a>
            </div></div>
            <div class="page-actions">${audit ? `<span class="badge ok">已审计</span><span class="mini">${esc(audit.auditor_name)} · ${esc(audit.created_at)}</span>` : `<span class="badge pending">待审计</span>`}</div>
        </div>
        <div class="grid two">
            <section class="card"><div class="card-head"><h2>正文</h2><span class="mini">${page.content ? page.content.length : 0} 字符</span></div>
                <article class="wiki-content">${page.content || '<div class="empty">（空）</div>'}</article>
            </section>
            <div>
                <section class="card">
                    <div class="card-head"><h2>审计</h2></div>
                    ${audit ? `<div class="audit-done"><p><b>结果：</b>${esc(RESULT_LABEL[audit.result] || audit.result)}</p><p><b>审计人：</b>${esc(audit.auditor_name)}</p><p><b>时间：</b>${esc(audit.created_at)}</p><p><b>备注：</b>${esc(audit.note || '（无）')}</p><p class="mini">每页只审计一次，该页已进入已审计集合。</p></div>`
                        : `<form class="audit-form" data-page="${page.id}">
                        <label>审计结果
                            <select name="result"><option value="pass">通过（内容无问题）</option><option value="issue">有问题（需修改）</option></select>
                        </label>
                        <label>备注（可选）<textarea name="note" rows="4" maxlength="1000" placeholder="记录审计发现、问题位置等"></textarea></label>
                        <button class="btn primary" type="submit">标记为已审计</button>
                        <div class="form-msg"></div>
                    </form>`}
                </section>
                <section class="card"><div class="card-head"><h2>版本历史</h2><span class="mini">最近 ${revisions.length} 条</span></div>
                    ${revisions.length ? `<table class="table"><thead><tr><th>版本</th><th>编辑者</th><th>时间</th><th>说明</th></tr></thead><tbody>
                    ${revisions.map((r) => `<tr><td class="mono">#${r.id}</td><td>${esc(r.editor_name || '-')}</td><td class="mono">${esc((r.created_at || '').slice(0, 16))}</td><td>${esc(r.revision_note || '')}</td></tr>`).join('')}
                    </tbody></table>` : '<div class="empty">无版本记录</div>'}
                </section>
            </div>
        </div>
        <script>window.__PAGE_ID=${page.id};</script>
        <script src="/page.js"></script>`;
        res.send(layout({ title: page.title, user: req.user, active: '/pages', csrf: req.user.csrf, body }));
    } catch (e) { next(e); }
});

app.post('/api/audits', auth, async (req, res) => {
    try {
        const csrf = req.headers['x-csrf'] || (req.body && req.body.csrf);
        if (!csrf || csrf !== req.user.csrf) return res.status(403).json({ ok: false, error: 'CSRF 校验失败，请刷新页面' });
        const pageId = Number(req.body.page_id);
        const result = req.body.result === 'issue' ? 'issue' : 'pass';
        const note = String(req.body.note || '').slice(0, 1000);
        if (!pageId) return res.status(400).json({ ok: false, error: '缺少 page_id' });
        const page = guildOnline ? await get(guildDb, 'SELECT id, title, slug, updated_at FROM wiki_pages WHERE id = ?', [pageId]) : null;
        if (!page) return res.status(404).json({ ok: false, error: '页面不存在' });
        const exists = await get(examDb, 'SELECT id, auditor_name FROM audits WHERE page_id = ?', [pageId]);
        if (exists) return res.status(409).json({ ok: false, error: `该页面已被 ${exists.auditor_name} 审计过（每页只审一次）` });
        await run(examDb, 'INSERT INTO audits (page_id, page_title, page_slug, auditor_id, auditor_name, result, note, page_updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            [page.id, page.title, page.slug, req.user.uid, req.user.name, result, note, page.updated_at || '', nowText()]);
        res.json({ ok: true, message: '已标记为已审计' });
    } catch (e) {
        if (String(e.message || '').includes('UNIQUE')) return res.status(409).json({ ok: false, error: '该页面已被审计（并发冲突）' });
        res.status(500).json({ ok: false, error: '审计写入失败' });
    }
});

app.get('/audits', auth, async (req, res, next) => {
    try {
        const scope = req.query.scope === 'all' ? 'all' : 'me';
        const rows = scope === 'all'
            ? await all(examDb, 'SELECT * FROM audits ORDER BY id DESC LIMIT 500')
            : await all(examDb, 'SELECT * FROM audits WHERE auditor_id = ? ORDER BY id DESC LIMIT 500', [req.user.uid]);
        const counts = await get(examDb, 'SELECT COUNT(*) AS c FROM audits');
        const body = `<h1>审计记录 <span class="mini">全站 ${counts.c} 条</span></h1>
        <div class="tabs"><a class="tab ${scope === 'me' ? 'active' : ''}" href="/audits">我的</a><a class="tab ${scope === 'all' ? 'active' : ''}" href="/audits?scope=all">全站</a></div>
        <table class="table"><thead><tr><th>#</th><th>页面</th><th>结果</th><th>审计人</th><th>备注</th><th>时间</th></tr></thead><tbody>
        ${rows.map((a) => `<tr><td class="mono">${a.id}</td><td><a href="/pages/${a.page_id}">${esc(a.page_title)}</a></td><td>${a.result === 'issue' ? '<span class="badge warn">有问题</span>' : '<span class="badge ok">通过</span>'}</td><td>${esc(a.auditor_name)}</td><td>${esc(a.note || '')}</td><td class="mono">${esc(a.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">暂无记录</td></tr>'}
        </tbody></table>`;
        res.send(layout({ title: '审计记录', user: req.user, active: '/audits', csrf: req.user.csrf, body }));
    } catch (e) { next(e); }
});

app.get('/healthz', (req, res) => res.json({ ok: true, guildOnline, port: PORT, time: nowText(), uptime: process.uptime() }));

app.use((err, req, res, next) => {
    console.error('[exam] error:', err);
    res.status(500).send(layout({ title: '服务错误', user: req.user || null, active: '/', csrf: req.user ? req.user.csrf : '', body: `<div class="card"><h2>服务错误</h2><p class="mono">${esc(err.message || err)}</p></div>` }));
});

(async () => {
    await initDb();
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`[exam] listening on 127.0.0.1:${PORT}  guildDb=${GUILD_DB_FILE} examDb=${EXAM_DB_FILE} oauth=${OAUTH.provider} client=${OAUTH.clientId}`);
    });
})();
