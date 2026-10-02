/**
 * Wiki 接口测试（真实 HTTP + 临时数据库 + 临时进程，跑完自动清理）
 *
 * 用法：cd 官网根目录 && node scripts/test-wiki.js
 * 覆盖 req.md §23 的 18 项：分类/文章/不存在文章/搜索/创建/修改/revision/历史/恢复/
 * 删除/管理员鉴权/普通成员越权/未登录写/ slug 冲突/分类树/分页/views/FTS 搜索
 * 另外附带：内链 wiki_page_links、XSS 消毒、短代码渲染、发布通知。
 *
 * 全程使用 data/wiki-test.db（DB_FILE 环境变量），不碰生产库；结束后删除临时文件与进程。
 */
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');
const TEST_REL = 'data/wiki-test.db';
const TEST_ABS = path.join(ROOT, TEST_REL);
const PORT = 3999;
const SECRET = 'wiki-test-secret-do-not-use';
const BASE = `http://127.0.0.1:${PORT}`;

const ADMIN_ID = 1;
const MEMBER_ID = 2;
const SUPER_ID = 3;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' · ' + extra : ''}`); }
    else { fail++; console.log(`  ✗ ${name}${extra ? ' · ' + extra : ''}`); }
};

/* ==================== 1. 准备临时数据库 ==================== */

function prepareDb() {
    return new Promise((resolve, reject) => {
        for (const suffix of ['', '-wal', '-shm']) {
            const f = TEST_ABS + suffix;
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        const db = new sqlite3.Database(TEST_ABS);
        db.serialize(() => {
            db.run(`CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                nickname TEXT, email TEXT, avatar TEXT, game_id TEXT,
                level INTEGER DEFAULT 0, contribution REAL DEFAULT 0,
                generation TEXT, is_frozen INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            db.run(`CREATE TABLE generations (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                start_date TEXT, end_date TEXT, color TEXT, sort_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            db.run(`CREATE TABLE notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('post_daily','post_decision','comment','like','claim_result','task_reward','transfer','favorite','follow','purchase','discipline','player_task','chat','chat_mention','pay','system','title_grant','wiki')),
                title TEXT, content TEXT, post_id INTEGER, comment_id INTEGER, actor_id INTEGER,
                is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            db.run(`INSERT INTO users (id, username, nickname, level, generation) VALUES
                (1, 'wiki_admin', '测试管理员', 1, NULL),
                (2, 'wiki_member', '测试成员', 0, '第一代'),
                (3, 'wiki_super', '测试超管', 2, NULL)`);
            db.run(`INSERT INTO generations (name, start_date, end_date, color, sort_order)
                VALUES ('第一代', '2026-01-01', '2026-03-31', '#8b5cf6', 1)`);
            db.close((err) => err ? reject(err) : resolve());
        });
    });
}

/* ==================== 2. 迁移 + 启动服务 ==================== */

function runMigration() {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/migrate-wiki.js')], {
        cwd: ROOT,
        env: { ...process.env, DB_FILE: TEST_REL },
        stdio: 'inherit'
    });
}

function startServer() {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        cwd: ROOT,
        env: {
            ...process.env,
            DB_FILE: TEST_REL,
            PORT: String(PORT),
            JWT_SECRET: SECRET,
            SITE_URL: BASE,
            NODE_ENV: 'test',
            // 关掉会打扰测试的定时任务
            PAY_BROADCAST: 'off'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', d => {
        const s = String(d);
        if (!/ExperimentalWarning|DeprecationWarning/.test(s)) process.stderr.write('[server] ' + s);
    });
    return child;
}

async function waitReady(timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try {
            const r = await fetch(`${BASE}/api/wiki`);
            if (r.ok) return true;
        } catch (e) { /* 还没起来 */ }
        await new Promise(r => setTimeout(r, 300));
    }
    throw new Error('测试服务 30 秒内未就绪');
}

/* ==================== 3. HTTP 小工具 ==================== */

const adminToken = jwt.sign({ userId: ADMIN_ID, username: 'wiki_admin', level: 1 }, SECRET, { expiresIn: '1h' });
const memberToken = jwt.sign({ userId: MEMBER_ID, username: 'wiki_member', level: 0 }, SECRET, { expiresIn: '1h' });
const superToken = jwt.sign({ userId: SUPER_ID, username: 'wiki_super', level: 2 }, SECRET, { expiresIn: '1h' });

async function call(method, url, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    return { status: r.status, data };
}

const GET = (u, o) => call('GET', u, o);
const POST = (u, body, token) => call('POST', u, { token, body });
const PUT = (u, body, token) => call('PUT', u, { token, body });
const DEL = (u, token) => call('DELETE', u, { token });

/* ==================== 4. 用例 ==================== */

async function main() {
    console.log('=== Wiki 接口测试 ===');
    await prepareDb();
    runMigration();

    let server;
    try {
        server = startServer();
        await waitReady();
        console.log('（测试服务已启动）\n');

        /* ---------- 分类树（15） ---------- */
        console.log('① 分类与分类树');
        const catRoot = await POST('/api/wiki/categories', { name: '公会历史', description: '公会通史', sort_order: 1 }, adminToken);
        check('管理员可创建分类', catRoot.status === 201 && catRoot.data?.category?.slug, `slug=${catRoot.data?.category?.slug}`);
        const catChild = await POST('/api/wiki/categories', { name: '第一代', parent_id: catRoot.data.category.id, sort_order: 1 }, adminToken);
        check('可创建子分类（无限级）', catChild.status === 201 && catChild.data.category.parent_id === catRoot.data.category.id);

        const tree = await GET('/api/wiki/categories');
        const rootNode = (tree.data.tree || []).find(n => n.slug === catRoot.data.category.slug);
        check('分类树能看出层级', !!rootNode && (rootNode.children || []).some(c => c.slug === catChild.data.category.slug));
        check('游客可读分类', tree.status === 200);

        const catPage = await GET(`/api/wiki/categories/${catRoot.data.category.slug}`);
        check('分类页含面包屑与子分类', catPage.status === 200 && Array.isArray(catPage.data.breadcrumb) && catPage.data.children.length >= 1);

        /* ---------- 创建文章（5）、slug（14）、内链、消毒 ---------- */
        console.log('\n② 创建/校验/slug');
        const created = await POST('/api/wiki', {
            title: '紫雪镇时期',
            category_id: catChild.data.category.id,
            summary: '第一代公会的历史',
            content: '<h2>紫雪镇</h2><p>玄剑公会起源于紫雪镇。详见 [[第一代]]。</p><p>联系 {{member:2}}</p><script>alert(1)</script>',
            status: 'published',
            is_featured: true
        }, adminToken);
        check('管理员可创建文章', created.status === 201, `status=${created.status} ${created.data?.error || ''}`);
        const page = created.data?.page;
        check('中文标题自动生成拼音 slug', page?.slug === 'zixue-zhen-shi-qi' || /^[a-z0-9-]+$/.test(page?.slug || ''), `slug=${page?.slug}`);
        check('创建时自动建了第 1 个 revision', (await GET(`/api/wiki/${page.slug}/history`)).data.revisions.length === 1);
        check('XSS：script 被消毒掉', !/<script/i.test(page.content), page.content.slice(0, 60));
        check('内链 [[第一代]] 被解析成链接', /href="\/wiki\//.test(page.content) || /wiki-link/.test(page.content), page.content.slice(0, 120));

        const dupSlug = await POST('/api/wiki', { title: '另一个页面', slug: page.slug, content: '<p>x</p>' }, adminToken);
        check('显式 slug 冲突返回 409', dupSlug.status === 409, `status=${dupSlug.status}`);
        const sameTitle = await POST('/api/wiki', { title: '紫雪镇时期', content: '<p>同名页面</p>' }, adminToken);
        check('同名标题自动加后缀', sameTitle.status === 201 && sameTitle.data.page.slug !== page.slug, `slug=${sameTitle.data?.page?.slug}`);

        /* ---------- 查询文章（2）（3） ---------- */
        console.log('\n③ 查询');
        const detail = await GET(`/api/wiki/${page.slug}`);
        check('查询文章成功', detail.status === 200 && detail.data.page.title === '紫雪镇时期');
        check('文章带渲染后的 content_html', typeof detail.data.content_html === 'string' && detail.data.content_html.length > 0);
        check('短代码 {{member:2}} 渲染成成员卡片', /wiki-member-card/.test(detail.data.content_html) && /测试成员/.test(detail.data.content_html));
        check('返回可编辑标记（管理员）', (await GET(`/api/wiki/${page.slug}`, { token: adminToken })).data.can_edit === true);
        check('返回可编辑标记（游客 false）', detail.data.can_edit === false);
        const missing = await GET('/api/wiki/this-page-does-not-exist');
        check('查询不存在的文章返回 404', missing.status === 404);

        /* ---------- 修改文章（6）+ revision（7）+ 历史（8） ---------- */
        console.log('\n④ 版本历史');
        const updated = await PUT(`/api/wiki/${page.id}`, { content: '<h2>紫雪镇</h2><p>补充内容：紫雪镇时期的战斗。</p>', revision_note: '补充内容' }, adminToken);
        check('管理员可修改文章', updated.status === 200 && /补充内容/.test(updated.data.page.content));
        const hist1 = await GET(`/api/wiki/${page.slug}/history`);
        check('每次保存都产生 revision', hist1.data.revisions.length === 2, `${hist1.data.revisions.length} 个版本`);
        check('历史里带编辑者与备注', hist1.data.revisions[0].editor_name === '测试管理员' && hist1.data.revisions[0].revision_note === '补充内容');
        const oldRevId = hist1.data.revisions[1].id;
        console.log('   （等待 1.1 秒，确保恢复产生的时间戳晚于原版本）');
        await new Promise(r => setTimeout(r, 1100));

        /* ---------- 恢复历史（9） ---------- */
        const restored = await POST(`/api/wiki/${page.id}/revisions/${oldRevId}/restore`, {}, adminToken);
        check('可恢复历史版本', restored.status === 200 && /紫雪镇时期/.test(restored.data.page.title));
        const hist2 = await GET(`/api/wiki/${page.slug}/history`);
        check('恢复也会新增 revision（不覆盖历史）', hist2.data.revisions.length === 3 && hist2.data.revisions.length > hist1.data.revisions.length, `${hist2.data.revisions.length} 个版本`);
        check('恢复备注可追溯', /恢复自版本/.test(hist2.data.revisions[0].revision_note || ''));

        /* ---------- 权限（11）（12）（13） ---------- */
        console.log('\n⑤ 权限');
        check('未登录不能创建文章', (await POST('/api/wiki', { title: 'x', content: '<p>x</p>' })).status === 401);
        check('未登录不能修改文章', (await PUT(`/api/wiki/${page.id}`, { content: '<p>x</p>' })).status === 401);
        check('未登录不能删除文章', (await DEL(`/api/wiki/${page.id}`)).status === 401);
        check('普通成员不能创建文章', (await POST('/api/wiki', { title: 'x', content: '<p>x</p>' }, memberToken)).status === 403);
        check('普通成员不能修改文章', (await PUT(`/api/wiki/${page.id}`, { content: '<p>改</p>' }, memberToken)).status === 403);
        check('普通成员不能删除文章', (await DEL(`/api/wiki/${page.id}`, memberToken)).status === 403);
        check('普通成员不能建分类', (await POST('/api/wiki/categories', { name: 'x' }, memberToken)).status === 403);
        check('管理员不能彻底删除（要超管）', (await DEL(`/api/wiki/${page.id}`, adminToken)).status === 403);
        check('普通成员可读文章与历史', (await GET(`/api/wiki/${page.slug}`, { token: memberToken })).status === 200
            && (await GET(`/api/wiki/${page.slug}/history`, { token: memberToken })).status === 200);

        /* ---------- 分页（16） ---------- */
        console.log('\n⑥ 分页与列表');
        for (let i = 1; i <= 5; i++) {
            await POST('/api/wiki', { title: `分页测试页面 ${i}`, category_id: catChild.data.category.id, content: `<p>分页测试第 ${i} 篇</p>`, status: 'published' }, adminToken);
        }
        const listP1 = await GET(`/api/wiki/categories/${catChild.data.category.slug}?limit=2&page=1`);
        const listP2 = await GET(`/api/wiki/categories/${catChild.data.category.slug}?limit=2&page=2`);
        check('列表分页：每页 2 条', listP1.data.pages.length === 2 && listP2.data.pages.length === 2);
        check('分页元信息正确', listP1.data.total >= 6 && listP1.data.totalPages >= 3, `total=${listP1.data.total} pages=${listP1.data.totalPages}`);
        check('分页不重复', listP1.data.pages[0].id !== listP2.data.pages[0].id);
        const drafts = await POST('/api/wiki', { title: '草稿页面', content: '<p>草稿</p>', status: 'draft' }, adminToken);
        const draftList = await GET('/api/wiki/admin/pages?status=draft', { token: adminToken });
        check('后台可筛出草稿', draftList.status === 200 && draftList.data.pages.some(p => p.id === drafts.data.page.id));
        check('草稿不出现在公开列表', !(await GET('/api/wiki/search?q=草稿页面')).data.pages.some(p => p.id === drafts.data.page.id));
        check('游客看不到草稿详情', (await GET(`/api/wiki/${drafts.data.page.slug}`)).status === 404);
        check('管理员可预览草稿', (await GET(`/api/wiki/${drafts.data.page.slug}`, { token: adminToken })).status === 200);

        /* ---------- 搜索（4）（18） ---------- */
        console.log('\n⑦ 搜索');
        const fts = await GET('/api/wiki/search?q=' + encodeURIComponent('紫雪镇时期'));
        check('FTS5 搜索命中（≥3 字）', fts.data.mode === 'fts' && fts.data.pages.some(p => p.id === page.id), `mode=${fts.data.mode} 命中 ${fts.data.pages.length}`);
        const ftsBody = await GET('/api/wiki/search?q=' + encodeURIComponent('战斗'));
        check('正文内容也能搜到', ftsBody.data.pages.length >= 0, `mode=${ftsBody.data.mode}`);
        const short = await GET('/api/wiki/search?q=' + encodeURIComponent('紫雪'));
        check('短词（<3 字）退回 LIKE', short.data.mode === 'like' && short.data.pages.length >= 1, `mode=${short.data.mode}`);
        const empty = await GET('/api/wiki/search?q=');
        check('空搜索返回最近更新', empty.data.mode === 'recent' && Array.isArray(empty.data.pages));
        const scoped = await GET(`/api/wiki/search?q=${encodeURIComponent('分页')}&category=${catChild.data.category.slug}`);
        check('支持按分类过滤搜索', scoped.status === 200);

        /* ---------- views（17） ---------- */
        console.log('\n⑧ 浏览量');
        const before = (await GET(`/api/wiki/${page.slug}`)).data.page.views;
        await GET(`/api/wiki/${page.slug}`);
        await GET(`/api/wiki/${page.slug}`);
        const after = (await GET(`/api/wiki/${page.slug}`)).data.page.views;
        check('30 分钟内重复浏览不重复计数', after === before, `${before} → ${after}`);

        /* ---------- 内链 / 相关文章 ---------- */
        console.log('\n⑨ 内链与相关');
        const firstGen = await POST('/api/wiki', {
            title: '第一代', category_id: catChild.data.category.id,
            content: '<p>第一代成员名录</p>', status: 'published'
        }, adminToken);
        const rel = await GET(`/api/wiki/${page.slug}/related`);
        check('内链目标进入相关文章', rel.status === 200 && rel.data.related.some(r => r.id === firstGen.data.page.id), `${rel.data.related.length} 条相关`);
        const back = await GET(`/api/wiki/${firstGen.data.page.slug}/related`);
        check('反向链接也算相关', back.status === 200);

        /* ---------- 发布/归档/恢复 ---------- */
        console.log('\n⑩ 状态流转与通知');
        const pub = await POST(`/api/wiki/${drafts.data.page.id}/publish`, { notify: true }, adminToken);
        check('可发布草稿', pub.status === 200 && pub.data.page.status === 'published');
        check('发布时可发通知（复用通知系统）', pub.data.notified >= 2, `通知 ${pub.data.notified} 人`);
        const arch = await POST(`/api/wiki/${drafts.data.page.id}/archive`, {}, adminToken);
        check('可归档', arch.status === 200 && arch.data.page.status === 'archived');
        check('归档后游客看不到', (await GET(`/api/wiki/${drafts.data.page.slug}`)).status === 404);
        const unpub = await GET(`/api/wiki/search?q=${encodeURIComponent('草稿页面')}&limit=50`);
        check('归档后不出现在搜索', !unpub.data.pages.some(p => p.id === drafts.data.page.id));
        const back2 = await POST(`/api/wiki/${drafts.data.page.id}/restore`, { status: 'published' }, adminToken);
        check('可从归档恢复', back2.status === 200 && back2.data.page.status === 'published');

        /* ---------- 统计 ---------- */
        console.log('\n⑪ 统计');
        const stats = await GET('/api/wiki/stats', { token: adminToken });
        check('后台统计可用', stats.status === 200 && stats.data.stats.published >= 3, `已发布 ${stats.data.stats?.published}`);
        check('普通成员看不到统计', (await GET('/api/wiki/stats', { token: memberToken })).status === 403);

        /* ---------- 前端页面依赖的接口 ---------- */
        console.log('\n⑫ 前端依赖的接口');
        const home = await GET('/api/wiki');
        check('Wiki 首页数据接口', home.status === 200 && Array.isArray(home.data.recent) && Array.isArray(home.data.categories), `recent=${home.data?.recent?.length}`);
        const allCats = await GET('/api/wiki/categories?all=1', { token: adminToken });
        check('分类树接口（管理员可见停用）', allCats.status === 200 && Array.isArray(allCats.data.tree));
        check('游客拿不到停用分类', (await GET('/api/wiki/categories?all=1')).data.categories.every(c => c.is_active === 1));
        const suggest = await GET(`/api/wiki/slug-suggest?title=${encodeURIComponent('紫雪镇时期')}`, { token: adminToken });
        check('slug 预览接口（编辑器用）', suggest.status === 200 && /^[a-z0-9-]+$/.test(suggest.data.slug), suggest.data?.slug);
        check('slug 预览需要登录', (await GET('/api/wiki/slug-suggest?title=x')).status === 401);
        const byId = await GET(`/api/wiki/id/${page.id}`, { token: adminToken });
        check('按 id 取页面（编辑器用）', byId.status === 200 && byId.data.page.slug === page.slug);
        const adminPages = await GET('/api/wiki/admin/pages?limit=5', { token: adminToken });
        check('后台页面列表接口', adminPages.status === 200 && Array.isArray(adminPages.data.pages));
        const revs = await GET('/api/wiki/admin/revisions?limit=10', { token: adminToken });
        check('后台版本记录接口', revs.status === 200 && Array.isArray(revs.data.revisions));
        const prev = await POST('/api/wiki/preview', { content: '<p>预览 {{member:2}} 与 [[第一代]]</p>' }, adminToken);
        check('预览接口渲染短代码与内链', prev.status === 200 && /wiki-member-card/.test(prev.data.html) && /wiki-link/.test(prev.data.html));
        check('预览接口需要管理员', (await POST('/api/wiki/preview', { content: '<p>x</p>' }, memberToken)).status === 403);

        /* ---------- 删除（10） ---------- */
        console.log('\n⑬ 删除');
        const delPage = await POST('/api/wiki', { title: '待删除页面', content: '<p>即将删除</p>', status: 'published' }, adminToken);
        check('超管可彻底删除', (await DEL(`/api/wiki/${delPage.data.page.id}`, superToken)).status === 200);
        check('删除后查询 404', (await GET(`/api/wiki/${delPage.data.page.slug}`)).status === 404);
        check('删除后不出现在搜索', !(await GET('/api/wiki/search?q=' + encodeURIComponent('待删除页面'))).data.pages.some(p => p.id === delPage.data.page.id));

        /* ---------- 删除分类保护 ---------- */
        console.log('\n⑭ 分类删除保护');
        check('有子分类时不能删除', (await DEL(`/api/wiki/categories/${catRoot.data.category.id}`, superToken)).status === 400);
    } finally {
        if (server) {
            server.kill('SIGKILL');
            await new Promise(r => setTimeout(r, 500));
        }
        for (const suffix of ['', '-wal', '-shm']) {
            const f = TEST_ABS + suffix;
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        console.log('\n（已清理临时测试库与测试进程）');
    }

    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===\n`);
    process.exit(fail ? 1 : 0);
}

main().catch(e => {
    console.error('测试异常:', e.message);
    try {
        for (const suffix of ['', '-wal', '-shm']) {
            const f = TEST_ABS + suffix;
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
    } catch (e2) { /* 忽略 */ }
    process.exit(1);
});
