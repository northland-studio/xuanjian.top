/**
 * 迁移：Wiki 系统（表 + 索引 + FTS5 全文搜索）
 *
 * 用法：cd 官网根目录 && node scripts/migrate-wiki.js
 * 特性：幂等（重复执行不报错、不重复建对象），可以在生产安全执行。
 *
 * 说明：
 *  - 全文索引用 FTS5 的 trigram 分词器：中文没有空格，unicode61 会把整段中文当成一个 token，
 *    搜不到；trigram 按 3 字符切片，中文子串搜索可用（<3 字的查询由 lib/wiki.js 退回 LIKE）。
 *  - wiki_search 是「独立索引表」，不依赖触发器：写入/更新/删除由 lib/wiki.js 显式同步，
 *    逻辑集中在一处，便于测试与排错。
 */
const db = require('../database');

const TABLES = [
    `CREATE TABLE IF NOT EXISTS wiki_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        icon TEXT,
        parent_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS wiki_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER,
        title TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        summary TEXT,
        content TEXT NOT NULL,
        cover_image TEXT,
        author_id INTEGER NOT NULL,
        last_editor_id INTEGER,
        status TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
        is_featured INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0,
        project_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        published_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS wiki_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        editor_id INTEGER NOT NULL,
        revision_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS wiki_page_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id INTEGER NOT NULL,
        target_page_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(page_id, target_page_id)
    )`
];

const INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_wiki_categories_parent ON wiki_categories(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_categories_slug ON wiki_categories(slug)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_pages_category ON wiki_pages(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_pages_slug ON wiki_pages(slug)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_pages_status ON wiki_pages(status)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_pages_updated ON wiki_pages(updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_pages_views ON wiki_pages(views DESC)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_revisions_page ON wiki_revisions(page_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_links_page ON wiki_page_links(page_id)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_links_target ON wiki_page_links(target_page_id)'
];

async function main() {
    console.log('=== Wiki 迁移开始 ===');

    for (const sql of TABLES) {
        await db.run(sql);
    }
    console.log(`✓ 业务表 ${TABLES.length} 张（wiki_categories / wiki_pages / wiki_revisions / wiki_page_links）`);

    for (const sql of INDEXES) {
        await db.run(sql);
    }
    console.log(`✓ 索引 ${INDEXES.length} 个`);

    // FTS5 全文索引（trigram 分词，适配中文子串搜索）
    let ftsReady = false;
    try {
        await db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(
            page_id UNINDEXED,
            title,
            summary,
            content,
            tokenize = 'trigram'
        )`);
        ftsReady = true;
        console.log('✓ FTS5 全文索引 wiki_search（trigram）');
    } catch (e) {
        // 老环境没有 FTS5/trigram：降级为普通表名占位，搜索走 LIKE
        console.warn('⚠ FTS5 不可用，将以 LIKE 兜底搜索：' + e.message);
    }

    if (ftsReady) {
        const cols = await db.all('PRAGMA table_info(wiki_search)');
        const hasPageId = (cols || []).some(c => c.name === 'page_id');
        if (!hasPageId) {
            console.warn('⚠ wiki_search 缺少 page_id 列（旧版本建的），正在重建索引表');
            await db.run('DROP TABLE IF EXISTS wiki_search');
            await db.run(`CREATE VIRTUAL TABLE wiki_search USING fts5(
                page_id UNINDEXED, title, summary, content, tokenize = 'trigram'
            )`);
        }
    }

    // 回填：索引表为空但已有页面时，补建索引
    if (ftsReady) {
        const cnt = await db.get('SELECT COUNT(*) AS c FROM wiki_search');
        const pages = await db.get("SELECT COUNT(*) AS c FROM wiki_pages WHERE status != 'archived'");
        if ((cnt?.c || 0) === 0 && (pages?.c || 0) > 0) {
            const { reindexAll } = require('../lib/wiki');
            const n = await reindexAll();
            console.log(`✓ 回填全文索引 ${n} 篇`);
        }
    }

    const tables = await db.all(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name LIKE 'wiki%' ORDER BY name"
    );
    console.log('现有 wiki 对象: ' + tables.map(t => t.name).join(', '));
    console.log('=== Wiki 迁移完成 ===');
    process.exit(0);
}

main().catch(e => {
    console.error('迁移失败:', e.message);
    process.exit(1);
});
