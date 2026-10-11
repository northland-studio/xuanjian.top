/**
 * 集市二维码 / 海报 / 地图画：生成 + **真实解码验证**
 *
 * 用法：
 *   DB_FILE=data/wiki-mobile-test.db node scripts/test-market-qr.js          # 直接调 lib + 解码
 *   DB_FILE=data/wiki-mobile-test.db node scripts/test-market-qr.js 3998     # 顺便验证 HTTP 接口出图
 *
 * 解码用纯 JS 实现（jsqr + pngjs，devDependency），不依赖系统 zbar。
 * 覆盖：
 *   1) 短链二维码 → 解码结果必须等于 https://xuanjian.top/q/<code>
 *   2) 分享海报（店铺/商品）→ 从整张海报里解码出同一条短链（验证二维码没被叠加破坏）
 *   3) 地图画 → 可正常出图（PNG 尺寸校验）
 *   4) HTTP 接口 /api/market/qr/<code>.png、/api/market/poster/<code>.png、/api/market/map/art.png
 *      返回真 PNG 且二维码可解码、短链 /q/<code> 会 302 到对应页面
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.resolve(ROOT, process.env.DB_FILE || 'data/guild.db');
const PORT = Number(process.argv[2]) || 0;
const BASE = PORT ? `http://127.0.0.1:${PORT}` : '';
const render = require('../lib/market-render');

const db = new sqlite3.Database(DB_PATH);
const get = (sql, a = []) => new Promise((r, j) => db.get(sql, a, (e, x) => e ? j(e) : r(x)));
const all = (sql, a = []) => new Promise((r, j) => db.all(sql, a, (e, x) => e ? j(e) : r(x)));
const run = (sql, a = []) => new Promise((r, j) => db.run(sql, a, function (e) { e ? j(e) : r(this); }));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' · ' + extra : ''}`); }
    else { fail++; failures.push(name); console.log(`  ✗ ${name}${extra ? ' · ' + extra : ''}`); }
}

/** PNG Buffer → 解码出的字符串（失败返回 null） */
function decodePng(buf) {
    const png = PNG.sync.read(buf);
    const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: 'attemptBoth' });
    return code ? code.data : null;
}

async function ensureShortLink(targetType, targetId) {
    const exist = await get('SELECT * FROM market_short_links WHERE target_type = ? AND target_id = ? AND disabled = 0', [targetType, targetId]);
    if (exist) return exist.code;
    const market = require('../lib/market');
    return market.shortLinkFor(targetType, targetId);
}

(async () => {
    console.log(`\n=== 集市二维码 / 海报 / 地图画 解码自检（库：${path.relative(ROOT, DB_PATH)}${BASE ? '，接口 ' + BASE : ''}）===`);

    // 找一个真实存在的店铺/商品（没有就临时造一个，结束删除）
    let store = await get(`SELECT * FROM market_stores WHERE status IN ('active','grace') ORDER BY id LIMIT 1`);
    let product = store ? await get(`SELECT * FROM market_products WHERE store_id = ? LIMIT 1`, [store.id]) : null;
    let tempStoreId = null, tempProductId = null;
    if (!store) {
        const u = await get('SELECT id FROM users LIMIT 1');
        const r = await run(
            `INSERT INTO market_stores (owner_id, name, slug, intro, status, tags, created_at, updated_at)
             VALUES (?, '二维码自检铺', ?, '临时数据', 'active', '[]', datetime('now','localtime'), datetime('now','localtime'))`,
            [u.id, `qr-check-${Date.now().toString(36)}`]
        );
        tempStoreId = r.lastID;
        store = await get('SELECT * FROM market_stores WHERE id = ?', [tempStoreId]);
    }
    if (store && !product) {
        const r = await run(
            `INSERT INTO market_products (store_id, title, summary, price, stock, status, tags, created_at, updated_at)
             VALUES (?, '二维码自检商品', '临时数据', 3.5, 5, 'on', '[]', datetime('now','localtime'), datetime('now','localtime'))`,
            [store.id]
        );
        tempProductId = r.lastID;
        product = await get('SELECT * FROM market_products WHERE id = ?', [tempProductId]);
    }

    // 1 短链二维码
    console.log('\n—— 1. 短链二维码 ——');
    const storeCode = await ensureShortLink('store', store.id);
    const expectStore = `https://xuanjian.top/q/${storeCode}`;
    const qrBuf = await render.shortQrPng(storeCode);
    check('二维码 PNG 头正确', qrBuf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
    const decoded = decodePng(qrBuf);
    check('短链二维码可被真实解码', !!decoded, decoded || '解码失败');
    check('解码内容 = 站点短链地址', decoded === expectStore, `${decoded} vs ${expectStore}`);
    const qrSize = PNG.sync.read(qrBuf);
    check('二维码尺寸 512×512', qrSize.width === 512 && qrSize.height === 512, `${qrSize.width}×${qrSize.height}`);

    // 2 海报
    console.log('\n—— 2. 分享海报（二维码叠加后仍可解码）——');
    const prodCode = product ? await ensureShortLink('product', product.id) : null;
    const storePoster = await render.sharePosterPng({
        kind: 'store', code: storeCode, title: store.name, intro: store.intro,
        tags: ['自检'], rating: 5, sales: 3, location: '115 主世界 X 100 Y 64 Z -200'
    });
    const storePosterPng = PNG.sync.read(storePoster);
    check('店铺海报出图 720×1000', storePosterPng.width === 720 && storePosterPng.height === 1000, `${storePosterPng.width}×${storePosterPng.height}`);
    const storeDecoded = decodePng(storePoster);
    check('店铺海报里的二维码可被解码', storeDecoded === `https://xuanjian.top/q/${storeCode}`, storeDecoded || '解码失败');
    fs.writeFileSync(path.join(ROOT, 'data', 'market-poster-store.png'), storePoster);

    if (prodCode) {
        const prodPoster = await render.sharePosterPng({
            kind: 'product', code: prodCode, title: product.title, storeName: store.name,
            subtitle: product.summary, price: product.price, stock: product.stock, spec: product.spec
        });
        const prodDecoded = decodePng(prodPoster);
        check('商品海报里的二维码可被解码', prodDecoded === `https://xuanjian.top/q/${prodCode}`, prodDecoded || '解码失败');
        fs.writeFileSync(path.join(ROOT, 'data', 'market-poster-product.png'), prodPoster);
    }

    // 3 地图画
    console.log('\n—— 3. 地图画 ——');
    const mapPng = await render.renderMapArt({
        points: [{ px: 20, py: 30, label: 'A' }, { px: 80, py: 70, label: 'B', highlight: true }],
        title: '紫雪坊市 · 店铺地图（自检）'
    });
    const mapPngInfo = PNG.sync.read(mapPng);
    check('地图画出图 640×640', mapPngInfo.width === 640 && mapPngInfo.height === 640, `${mapPngInfo.width}×${mapPngInfo.height}`);
    fs.writeFileSync(path.join(ROOT, 'data', 'market-map-art.png'), mapPng);

    // 4 HTTP 接口
    if (BASE) {
        console.log('\n—— 4. HTTP 接口 ——');
        const r1 = await fetch(`${BASE}/api/market/qr/${storeCode}.png`);
        const b1 = Buffer.from(await r1.arrayBuffer());
        check('GET /api/market/qr/<code>.png 200 + PNG', r1.status === 200 && b1.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `HTTP ${r1.status}`);
        check('接口二维码解码一致', decodePng(b1) === expectStore);
        const r2 = await fetch(`${BASE}/api/market/qr/NOPE99.png`);
        check('不存在的短链返回 404（不会变成任意二维码生成器）', r2.status === 404, `HTTP ${r2.status}`);
        const r3 = await fetch(`${BASE}/api/market/poster/${storeCode}.png`);
        const b3 = Buffer.from(await r3.arrayBuffer());
        check('GET /api/market/poster/<code>.png 200 + 可解码', r3.status === 200 && decodePng(b3) === expectStore, `HTTP ${r3.status}`);
        const r4 = await fetch(`${BASE}/api/market/map/art.png`);
        const b4 = Buffer.from(await r4.arrayBuffer());
        check('GET /api/market/map/art.png 200 + PNG', r4.status === 200 && b4.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `HTTP ${r4.status}`);
        const r5 = await fetch(`${BASE}/q/${storeCode}`, { redirect: 'manual' });
        check('短链 /q/<code> 302 跳到店铺页', r5.status === 302 && String(r5.headers.get('location')).includes(`/market/store/${store.id}`),
            `${r5.status} → ${r5.headers.get('location')}`);
        const r6 = await fetch(`${BASE}/q/NOPE99`, { redirect: 'manual' });
        check('未知短链 404', r6.status === 404, `HTTP ${r6.status}`);
    } else {
        console.log('\n· 未传端口，跳过 HTTP 接口检查（可传 3998 让测试服务参与）');
    }

    // 清理临时数据
    if (tempProductId) {
        await run('DELETE FROM market_product_images WHERE product_id = ?', [tempProductId]);
        await run('DELETE FROM market_short_links WHERE target_type = ? AND target_id = ?', ['product', tempProductId]);
        await run('DELETE FROM market_products WHERE id = ?', [tempProductId]);
    }
    if (tempStoreId) {
        await run('DELETE FROM market_short_links WHERE target_type = ? AND target_id = ?', ['store', tempStoreId]);
        await run('DELETE FROM market_stores WHERE id = ?', [tempStoreId]);
    }
    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
    if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
    console.log('（示例图已写到 data/market-poster-store.png / data/market-poster-product.png / data/market-map-art.png）');
    db.close();
    process.exit(fail ? 1 : 0);
})().catch(async (e) => {
    console.error('自检中断：', e.message);
    db.close();
    process.exit(1);
});
