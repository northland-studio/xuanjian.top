/**
 * 修复：结算（ΔP 上涨）没有写入价格序列，导致曲线不变
 *  - settleByTask 之后追加一条 stock_prices（volume=0，标记为结算）
 *  - history 合并成交与结算点，按时间正序，标签用 Asia/Shanghai 的 MM-DD HH:mm
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');

{
    const p = path.join(ROOT, 'lib', 'express-index.js');
    let s = fs.readFileSync(p, 'utf8');

    // 1. 结算后写入价格序列
    s = s.replace(
        `        await db.run(
            \`INSERT INTO stock_settlements (stock_id, task_id, reward, finish_count, price_before, price_after, delta, formula, operator_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\`,`,
        `        // 追加价格点，让前端曲线能反映结算带来的涨跌
        await db.run(
            'INSERT INTO stock_prices (stock_id, price, volume, recorded_at) VALUES (?, ?, 0, CURRENT_TIMESTAMP)',
            [stock.id, after]
        ).catch(() => {});
        await db.run(
            \`INSERT INTO stock_settlements (stock_id, task_id, reward, finish_count, price_before, price_after, delta, formula, operator_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\``
    );

    // 2. history 合并成交与结算价格点
    s = s.replace(
        `    const trades = rows.reverse().map((r) => ({ label: String(r.recorded_at).slice(11, 16), price: Number(r.price) }));`,
        `    const toLabel = (t) => {
        const d = new Date(String(t).replace(' ', 'T') + (String(t).includes('Z') ? '' : 'Z'));
        const sh = new Date(d.getTime() + 8 * 3600 * 1000);
        return String(sh.getUTCMonth() + 1).padStart(2, '0') + '-' + String(sh.getUTCDate()).padStart(2, '0') + ' ' +
            String(sh.getUTCHours()).padStart(2, '0') + ':' + String(sh.getUTCMinutes()).padStart(2, '0');
    };
    const trades = rows
        .slice()
        .reverse()
        .map((r) => ({ label: toLabel(r.recorded_at), price: Number(r.price), ts: new Date(String(r.recorded_at).replace(' ', 'T') + 'Z').getTime() }));
    // 结算也作为价格点（若与成交价相同则去重）
    const settleRows = await db.all(
        'SELECT price_after, created_at FROM stock_settlements WHERE stock_id = ? ORDER BY id DESC LIMIT 60',
        [stockId]
    ).catch(() => []);
    settleRows.forEach((r) => {
        const price = Number(r.price_after);
        const ts = new Date(String(r.created_at).replace(' ', 'T') + 'Z').getTime();
        if (!trades.some((t) => Math.abs(t.ts - ts) < 1000 && Math.abs(t.price - price) < 0.001)) {
            trades.push({ label: toLabel(r.created_at), price, ts });
        }
    });
    trades.sort((a, b) => a.ts - b.ts);
    trades.forEach((t) => { delete t.ts; });`
    );

    fs.writeFileSync(p, s, 'utf8');
    console.log('  ✓ 结算写入价格序列；history 合并成交+结算点');
}

const { execFileSync } = require('node:child_process');
try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, 'lib/express-index.js')], { stdio: 'pipe' });
    console.log('  ✓ 语法通过');
} catch (e) {
    console.log('  ✗ 语法失败：' + String(e.stderr || '').slice(0, 400));
    process.exit(1);
}
