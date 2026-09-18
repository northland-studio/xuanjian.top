/**
 * 经济面板数据采集（只读导出库）
 * 采集区间：2026-08-06 ~ 2026-09-06（含）
 * 指标：
 *   1) 五项监控参数：参与率 / 消费率 / 流通速度 / 总量增速 / 基尼系数
 *   2) 每天活跃人数
 *   3) 贡献点总存量
 *   4) 流入量 / 流出量
 *   另：列出「有营业额的商品」及其上架时间，用于在折线图上打标
 *
 * 口径与 routes/economics.js 完全一致（见 README 注释）。
 * 用法：node scripts/econ/collect.js "H:/chengxuyuanma/guanwang/guild (1).db"
 */
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

const DB = process.argv[2] || path.join(__dirname, '..', '..', 'guild (1).db');
const OUT_DIR = path.join(__dirname, '..', '..', 'reports');
const START = '2026-08-06';
const END = '2026-09-06';

const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);
const all = (s, p = []) => new Promise((r, j) => db.all(s, p, (e, x) => e ? j(e) : r(x)));

// ---------- 工具 ----------
const day = (ts) => String(ts || '').slice(0, 10);
const addDays = (d, n) => {
    const t = new Date(d + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
};
const rangeDays = (a, b) => {
    const out = [];
    for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
    return out;
};

/** 基尼系数（与 economics.js 一致：仅统计余额>0 的成员） */
function calcGini(values) {
    const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) return 0;
    const sum = sorted.reduce((s, v) => s + v, 0);
    if (sum === 0) return 0;
    let cumulative = 0;
    for (let i = 0; i < n; i++) cumulative += (i + 1) * sorted[i];
    return (2 * cumulative) / (n * sum) - (n + 1) / n;
}

(async () => {
    // ---------- 读数据 ----------
    const logs = await all(`SELECT user_id, amount, type, ref_id, created_at FROM contribution_logs ORDER BY created_at, id`);
    const users = await all(`SELECT id, contribution, created_at FROM users`);
    const checkins = await all(`SELECT user_id, checkin_date FROM checkins`);
    const claims = await all(`SELECT user_id, status, completed_at, created_at FROM task_claims`);
    const shopItems = await all(`SELECT id, name, price, is_active, created_at, updated_at FROM shop_items`);
    const titleRows = await all(`SELECT id, name, price, is_active, created_at FROM titles`);
    const titleById = new Map(titleRows.map(t => [t.id, t]));
    const shopByRefForTitle = new Map(shopItems.filter(i => i.type === 'title' && i.ref_id != null).map(i => [i.ref_id, i]));

    const supplyNow = users.reduce((s, u) => s + (u.contribution || 0), 0);

    // ---------- 有营业额的商品（type='purchase' / 'title' 的 ref_id） ----------
    const itemById = new Map(shopItems.map(i => [i.id, i]));
    const revenueMap = new Map();
    const bump = (key, amount, at) => {
        const cur = revenueMap.get(key) || { orders: 0, revenue: 0, firstAt: null, lastAt: null };
        cur.orders += 1;
        cur.revenue += -amount;
        if (!cur.firstAt || at < cur.firstAt) cur.firstAt = at;
        if (!cur.lastAt || at > cur.lastAt) cur.lastAt = at;
        revenueMap.set(key, cur);
    };
    logs.filter(l => l.type === 'purchase').forEach(l => bump(`item:${l.ref_id}`, l.amount, l.created_at));
    logs.filter(l => l.type === 'title').forEach(l => bump(`title:${l.ref_id}`, l.amount, l.created_at));

    const products = [...revenueMap.entries()].map(([key, v]) => {
        const isTitle = key.startsWith('title:');
        const refId = key.split(':')[1];
        // 称号的「上架时间」：优先取商店条目(shop_items, type=title)的创建时间，否则退回称号自身的创建时间
        const item = isTitle ? shopByRefForTitle.get(Number(refId)) : itemById.get(Number(refId));
        const title = isTitle ? titleById.get(Number(refId)) : null;
        const listedAt = item ? item.created_at : (title ? title.created_at : null);
        return {
            key,
            kind: isTitle ? '称号' : '商品',
            name: item ? item.name : (title ? title.name : key),
            price: item ? item.price : (title ? title.price : null),
            listedAt,
            listedDate: day(listedAt),
            active: item ? !!item.is_active : (title ? !!title.is_active : null),
            orders: v.orders,
            revenue: Math.round(v.revenue * 100) / 100,
            firstOrderAt: v.firstAt,
            lastOrderAt: v.lastAt,
        };
    }).sort((a, b) => (a.listedDate || '').localeCompare(b.listedDate || ''));

    // ---------- 逐日重建 ----------
    const days = rangeDays(START, END);
    // 每个用户当前余额（用于反推历史）
    const balNow = new Map(users.map(u => [u.id, u.contribution || 0]));

    // 按日聚合日志
    const daily = new Map(); // date -> { inflow, outflow, users:Set, logs:[] }
    const ensure = (d) => {
        if (!daily.has(d)) daily.set(d, { inflow: 0, outflow: 0, users: new Set() });
        return daily.get(d);
    };
    logs.forEach(l => {
        const d = day(l.created_at);
        const e = ensure(d);
        if (l.amount > 0) e.inflow += l.amount;
        else e.outflow += -l.amount;
        e.users.add(l.user_id);
    });
    // 签到活跃
    const dailyCheckin = new Map();
    checkins.forEach(c => {
        const d = day(c.checkin_date);
        if (!dailyCheckin.has(d)) dailyCheckin.set(d, new Set());
        dailyCheckin.get(d).add(c.user_id);
    });

    // 累计序列（用于各项指标）
    const rows = [];
    const totalLogsAfterCache = new Map(); // date -> 该日之后的日志净额、以及每用户净额

    // 预计算：按日累计（截至某日的累计流入/流出）
    const sortedDates = [...new Set(logs.map(l => day(l.created_at)))].sort();
    const cumByDate = new Map();
    let ci = 0, co = 0;
    for (const d of sortedDates) {
        const e = daily.get(d);
        ci += e.inflow; co += e.outflow;
        cumByDate.set(d, { inflow: ci, outflow: co });
    }
    const cumUpTo = (d) => {
        let best = null;
        for (const k of sortedDates) { if (k <= d) best = cumByDate.get(k); else break; }
        return best || { inflow: 0, outflow: 0 };
    };
    // 区间内累计
    const sumRange = (a, b) => {
        let inf = 0, out = 0;
        for (const [d, e] of daily) {
            if (d >= a && d <= b) { inf += e.inflow; out += e.outflow; }
        }
        return { inflow: inf, outflow: out };
    };

    // 反推：某日结束时的总存量 = 当前存量 - 该日之后的日志净额
    const netAfter = (d) => {
        let n = 0;
        logs.forEach(l => { if (day(l.created_at) > d) n += l.amount; });
        return n;
    };

    // 每用户在某日结束时的余额（用于基尼）
    const perUserAfter = new Map(); // date -> Map(userId, netAfter)
    {
        const byDate = new Map();
        logs.forEach(l => {
            const d = day(l.created_at);
            if (!byDate.has(d)) byDate.set(d, new Map());
            const m = byDate.get(d);
            m.set(l.user_id, (m.get(l.user_id) || 0) + l.amount);
        });
        // 从最后一天往前累加
        const acc = new Map();
        const datesDesc = [...byDate.keys()].sort().reverse();
        const snapshots = new Map();
        for (const d of datesDesc) {
            byDate.get(d).forEach((v, u) => acc.set(u, (acc.get(u) || 0) + v));
            snapshots.set(d, new Map(acc));
        }
        // 查询函数：某日之后（>d）每用户净额
        const afterOf = (d) => {
            // 找到 <= d 的最近快照
            let bestD = null;
            for (const k of [...snapshots.keys()].sort()) { if (k <= d) bestD = k; else break; }
            return bestD ? snapshots.get(bestD) : new Map();
        };
        days.forEach(d => perUserAfter.set(d, afterOf(d)));
    }

    for (const d of days) {
        const e = daily.get(d) || { inflow: 0, outflow: 0, users: new Set() };
        const chk = dailyCheckin.get(d) || new Set();
        const activeSet = new Set([...e.users, ...chk]);
        const activeCount = activeSet.size;

        // 总存量（该日结束时）
        const supply = supplyNow - netAfter(d);

        // 累计（截至 d）
        const cum = cumUpTo(d);
        const consumptionRate = cum.inflow > 0 ? cum.outflow / cum.inflow : 0;

        // 近14天
        const p14 = sumRange(addDays(d, -13), d);
        const net14 = p14.inflow - p14.outflow;
        const startSupply = Math.max(supply - net14, 0);
        const avgSupply = (startSupply + supply) / 2;
        const velocity = avgSupply > 0 ? p14.outflow / avgSupply : 0;
        const growth = startSupply > 0 ? p14.inflow / startSupply : 0;

        // 近30天活跃成员数
        const d30 = addDays(d, -29);
        const active30 = new Set();
        checkins.forEach(c => { const dd = day(c.checkin_date); if (dd >= d30 && dd <= d) active30.add(c.user_id); });
        logs.forEach(l => { const dd = day(l.created_at); if (dd >= d30 && dd <= d) active30.add(l.user_id); });
        // 完成任务成员数（截至 d）
        const taskDone = new Set();
        claims.forEach(c => {
            if (c.status !== 'completed') return;
            const dd = day(c.completed_at || c.created_at);
            if (dd <= d) taskDone.add(c.user_id);
        });
        const participation = active30.size > 0 ? taskDone.size / active30.size : 0;

        // 基尼
        const after = perUserAfter.get(d) || new Map();
        const balances = users.map(u => (balNow.get(u.id) || 0) - (after.get(u.id) || 0));
        const gini = calcGini(balances);

        rows.push({
            date: d,
            participation,          // 参与率
            consumption: consumptionRate, // 消费率
            velocity,               // 流通速度
            growth,                 // 总量增速
            gini,                   // 基尼系数
            activeUsers: activeCount,
            supply: Math.round(supply * 100) / 100,
            inflow: Math.round(e.inflow * 100) / 100,
            outflow: Math.round(e.outflow * 100) / 100,
            active30: active30.size,
            taskDone: taskDone.size,
        });
    }

    // ---------- 输出 ----------
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const base = path.join(OUT_DIR, `econ-${START}_${END}`);
    fs.writeFileSync(base + '.json', JSON.stringify({ range: { START, END }, products, rows }, null, 2), 'utf8');

    // CSV
    const head = ['date', 'participation', 'consumption', 'velocity', 'growth', 'gini', 'activeUsers', 'supply', 'inflow', 'outflow', 'active30', 'taskDone'];
    const csv = [head.join(',')].concat(rows.map(r => head.map(h => {
        const v = r[h];
        return typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(6)) : v;
    }).join(','))).join('\n');
    fs.writeFileSync(base + '.csv', '\uFEFF' + csv, 'utf8');

    // ---------- 控制台摘要 ----------
    console.log(`导出库: ${DB}`);
    console.log(`区间: ${START} ~ ${END}（${rows.length} 天）`);
    console.log(`当前总存量(库内 users.contribution 合计): ${supplyNow}`);
    console.log(`区间起点存量: ${rows[0].supply}   区间终点存量: ${rows[rows.length - 1].supply}`);
    console.log(`区间流入合计: ${rows.reduce((s, r) => s + r.inflow, 0)}   流出合计: ${rows.reduce((s, r) => s + r.outflow, 0)}`);
    console.log('\n有营业额的商品:');
    products.forEach(p => {
        console.log(`  ${String(p.name).padEnd(14)} 上架=${p.listedAt} 订单=${String(p.orders).padStart(3)} 营业额=${p.revenue}  ${p.active ? '' : '(已下架)'}`);
    });
    console.log('\n逐日数据:');
    console.log('date        participation consumption velocity growth  gini   active supply inflow outflow');
    rows.forEach(r => {
        console.log(`${r.date}  ${(r.participation * 100).toFixed(1).padStart(8)}%  ${(r.consumption * 100).toFixed(1).padStart(8)}%  ${r.velocity.toFixed(3).padStart(7)}  ${(r.growth * 100).toFixed(1).padStart(6)}%  ${r.gini.toFixed(4)}  ${String(r.activeUsers).padStart(5)}  ${String(r.supply).padStart(6)}  ${String(r.inflow).padStart(5)}  ${String(r.outflow).padStart(6)}`);
    });

    console.log(`\n已写出: ${base}.json / ${base}.csv`);
    db.close();
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
