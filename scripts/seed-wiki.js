#!/usr/bin/env node
/**
 * Wiki 种子数据入口（req.md §21）
 *
 * 两种用法：
 *   1) 有《玄剑公会通史0517》docx 的环境（开发机）：解析 + 压缩上传七牛 + 写库
 *        node scripts/seed-wiki.js
 *        node scripts/seed-wiki.js --dry-run      # 只解析统计，不写库不上传
 *        node scripts/seed-wiki.js --no-images    # 跳过图片上传
 *        node scripts/seed-wiki.js --limit=2      # 只传前 2 张图（联调用）
 *
 *   2) 生产环境（没有 docx，也不想传 100MB 源文件）：导入本地导出的 JSON
 *        node scripts/seed-wiki.js --from-json data/wiki-seed-export.json
 *      JSON 里的 <img src> 已经指向七牛，导入只做「建分类 + 建/更新页面 + 重建全文索引」。
 *
 * 幂等：分类按 slug、页面按标题匹配；重复执行不会产生重复内容（页面内容一致则跳过）。
 */
const fs = require('fs');
const path = require('path');

function getArg(name) {
    const i = process.argv.indexOf(name);
    if (i < 0) return undefined;
    const v = process.argv[i + 1];
    return (v === undefined || v.startsWith('--')) ? true : v;
}

async function importFromJson(file) {
    const wiki = require('../lib/wiki');
    const db = require('../database');

    const abs = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
    if (!fs.existsSync(abs)) throw new Error('找不到导入文件：' + abs);
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));

    const admin = await db.get('SELECT id, username, nickname FROM users WHERE level >= 2 ORDER BY level DESC, id LIMIT 1');
    if (!admin) throw new Error('找不到 level>=2 的管理员账号，无法确定页面作者');
    console.log(`导入来源：${data.source || abs}`);
    console.log(`管理员（作者/编辑者）：#${admin.id} ${admin.nickname || admin.username}`);

    // ---- 1. 分类（按 slug 幂等，父分类按 parent_slug 解析）----
    console.log('\n同步分类……');
    const catIdBySlug = new Map();
    for (const c of data.categories || []) {
        let row = await db.get('SELECT * FROM wiki_categories WHERE slug = ?', [c.slug]);
        if (!row) {
            let parentId = null;
            if (c.parent_slug) {
                parentId = catIdBySlug.get(c.parent_slug)
                    || (await db.get('SELECT id FROM wiki_categories WHERE slug = ?', [c.parent_slug]))?.id
                    || null;
            }
            row = await wiki.createCategory({
                name: c.name, slug: c.slug, description: c.description, icon: c.icon,
                parent_id: parentId, sort_order: c.sort_order, is_active: c.is_active !== 0
            }, admin.id);
            console.log(`  ＋分类 ${row.name}（#${row.id} slug=${row.slug}）`);
        } else {
            console.log(`  ＝分类已存在 ${row.name}`);
        }
        catIdBySlug.set(c.slug, row.id);
    }

    // ---- 2. 页面（按标题幂等）----
    console.log('\n同步页面……');
    let created = 0, updated = 0, unchanged = 0;
    for (const p of data.pages || []) {
        let categoryId = null;
        if (p.category_slug) {
            categoryId = catIdBySlug.get(p.category_slug)
                || (await db.get('SELECT id FROM wiki_categories WHERE slug = ?', [p.category_slug]))?.id
                || null;
        }
        const existing = await db.get('SELECT id, content, summary, category_id FROM wiki_pages WHERE title = ?', [p.title]);
        if (!existing) {
            const page = await wiki.createPage({
                title: p.title, slug: p.slug, summary: p.summary, content: p.content,
                cover_image: p.cover_image, status: p.status || 'published',
                is_featured: p.is_featured, is_pinned: p.is_pinned, category_id: categoryId
            }, admin.id);
            created += 1;
            console.log(`  ＋新建 ${page.title}（/wiki/${page.slug}）`);
        } else if (existing.content !== p.content || existing.summary !== p.summary || existing.category_id !== categoryId) {
            await wiki.updatePage(existing.id, {
                title: p.title, summary: p.summary, content: p.content,
                cover_image: p.cover_image, status: p.status || 'published',
                is_featured: p.is_featured, is_pinned: p.is_pinned, category_id: categoryId
            }, admin.id, '通史种子更新');
            updated += 1;
            console.log(`  ↻更新 ${p.title}`);
        } else {
            unchanged += 1;
        }
    }

    // ---- 3. 重建全文索引（幂等）----
    const indexed = await wiki.reindexAll();

    // ---- 4. 自检 ----
    const total = await db.get("SELECT COUNT(*) AS c FROM wiki_pages WHERE status = 'published'");
    const withImg = await db.get("SELECT COUNT(*) AS c FROM wiki_pages WHERE content LIKE '%<img %'");
    console.log('\n--- 导入自检 ---');
    console.log(`  分类：${(data.categories || []).length} 个`);
    console.log(`  页面：新建 ${created} / 更新 ${updated} / 未变 ${unchanged}`);
    console.log(`  已发布总篇数：${total.c}`);
    console.log(`  含图片的页面：${withImg.c}`);
    console.log(`  全文索引重建：${indexed} 篇`);
    console.log(created + updated > 0 ? '\n导入完成 ✓' : '\n没有需要变更的内容（已是最新）✓');
}

async function main() {
    const fromJson = getArg('--from-json');
    if (fromJson) {
        await importFromJson(String(fromJson));
        process.exit(0);
    }

    // 有 docx 的环境：直接解析导入
    const { seedHistory } = require('./seed/history.js');
    await seedHistory({
        dryRun: !!getArg('--dry-run'),
        uploadImages: getArg('--no-images') === undefined,
        imageLimit: Number(getArg('--limit') || 0) || 0
    });
    process.exit(0);
}

main().catch(e => {
    console.error('种子执行失败：' + (e && e.message));
    if (e && e.report) console.error(JSON.stringify(e.report.checks, null, 2));
    process.exit(1);
});
