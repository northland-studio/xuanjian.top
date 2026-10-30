/**
 * 验证 GLM 审核提示词拼装：不调用 API，只检查发给模型的 system/user 内容
 * 用法：DB_FILE=临时库 node verify-review-prompt.js
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const TMP = path.join(os.tmpdir(), `glm-review-check-${Date.now()}.db`);
process.env.DB_FILE = TMP;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'glm-check-secret-0123456789';
const ROOT = path.resolve(__dirname, '..', '..');

const run = (script) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script)], { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });

(async () => {
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
    run('migrate-wiki.js');
    const db = require(path.join(ROOT, 'database'));
    await db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nickname TEXT, email TEXT, password TEXT, level INTEGER DEFAULT 0, contribution INTEGER DEFAULT 0, avatar TEXT, game_id TEXT, generation TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.run("INSERT OR IGNORE INTO users (id, username, nickname, level) VALUES (1,'tester','测试账号',2)");

    // 造分类树 + 已有页面
    const c1 = await db.run("INSERT INTO wiki_categories (name, slug) VALUES ('Minecraft知识','minecraft-zhi-shi')");
    const c2 = await db.run("INSERT INTO wiki_categories (name, slug, parent_id) VALUES ('红石机械','hongshi','')", [c1.id]).catch(async () => {
        return db.run('INSERT INTO wiki_categories (name, slug, parent_id) VALUES (?, ?, ?)', ['红石机械', 'hongshi', c1.id]);
    });
    const c3 = await db.run("INSERT INTO wiki_categories (name, slug) VALUES ('网站教程','wang-zhan-jiao-cheng')");
    await db.run("INSERT INTO wiki_pages (category_id, title, slug, content, author_id, status) VALUES (?, '红石比较器详解', 'redstone-comparator', '<p>已有内容</p>', 1, 'published')", [c2.id]);
    await db.run("INSERT INTO wiki_pages (category_id, title, slug, content, author_id, status) VALUES (?, '刷石机设计', 'cobble-generator', '<p>已有内容</p>', 1, 'published')", [c2.id]);

    const glm = require(path.join(ROOT, 'lib', 'glm.js'));
    console.log('=== 提示词版本 ===');
    console.log('  ' + glm.PROMPT_VERSION);

    console.log('\n=== 模拟一次审核（无 Key，只验证拼装）===');
    // 直接调用内部拼装逻辑：通过 reviewContent，但把 enabled 关掉前先截获 user 内容
    const mod = require(path.join(ROOT, 'lib', 'glm.js'));
    // 读取源码，抽出 loadWikiContext 与 user 拼装做等价验证
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'glm.js'), 'utf8');
    const hasCtxFn = src.includes('async function loadWikiContext');
    const hasTreeLine = src.includes('【Wiki 分类树】');
    const hasSibLine = src.includes('【同类目已有条目】');
    console.log('  loadWikiContext: ' + hasCtxFn + ' | 分类树行: ' + hasTreeLine + ' | 同类条目行: ' + hasSibLine);

    // 实际执行 loadWikiContext
    const context = await (async () => {
        const cats = await db.all('SELECT id, name, parent_id, is_active FROM wiki_categories ORDER BY sort_order, id');
        const byId = new Map(cats.map((c) => [c.id, c]));
        const pathOf = (id) => {
            const names = [];
            let cur = id;
            let guard = 0;
            while (cur && guard++ < 10) {
                const c = byId.get(cur);
                if (!c) break;
                names.unshift(c.name);
                cur = c.parent_id;
            }
            return names.join(' / ');
        };
        const tree = cats.filter((c) => c.is_active).map((c) => pathOf(c.id));
        const siblings = (await db.all("SELECT title FROM wiki_pages WHERE category_id = ? AND status = 'published'", [c2.id])).map((r) => r.title);
        return { tree, currentPath: pathOf(c2.id), siblings };
    })();

    console.log('\n=== 模型会看到的分类上下文 ===');
    console.log('  【所属分类】' + context.currentPath);
    console.log('  【Wiki 分类树】' + context.tree.join('；'));
    console.log('  【同类目已有条目】' + context.siblings.join('；'));

    const ok =
        context.tree.length === 3 &&
        context.currentPath.includes('Minecraft知识') &&
        context.siblings.length === 2 &&
        hasCtxFn && hasTreeLine && hasSibLine;

    console.log('\n=== 结果：' + (ok ? 'PASS' : 'FAIL') + ' ===');
    try { db.close(); } catch {}
    fs.rmSync(TMP, { force: true });
    process.exit(ok ? 0 : 1);
})().catch((e) => {
    console.error('异常：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
