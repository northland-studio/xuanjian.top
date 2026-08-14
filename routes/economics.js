/**
 * 经济学看板：玄剑贡献点试点方案观测指标实时计算
 * 纯只读查询，不修改任何数据库结构或数据
 */
const express = require('express');
const XLSX = require('xlsx');
const logger = require('../lib/logger');
const db = require('../database');
const router = express.Router();

// Date → 本地时间字符串（YYYY-MM-DD HH:MM:SS）
function toLocalStr(date) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date - offset).toISOString().slice(0, 19).replace('T', ' ');
}

// 计算基尼系数（按持有量排序的洛伦兹曲线面积比，0=完全平等，1=完全集中）
function calcGini(values) {
    const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) return 0;
    const sum = sorted.reduce((s, v) => s + v, 0);
    if (sum === 0) return 0;
    let cumulative = 0;
    for (let i = 0; i < n; i++) {
        cumulative += (i + 1) * sorted[i];
    }
    return (2 * cumulative) / (n * sum) - (n + 1) / n;
}

// 经济观测总览
router.get('/overview', async (req, res) => {
    try {
        const now = Date.now();

        // ---- 总量 ----
        const supply = await db.get(
            `SELECT COUNT(*) AS total_users,
                    COUNT(CASE WHEN COALESCE(contribution,0) > 0 THEN 1 END) AS holders,
                    COALESCE(SUM(contribution), 0) AS total_supply
             FROM users`
        );

        // ---- 参与率 ----
        // 活跃总人数：近30天有签到记录 或 有贡献点流水的用户
        const activeRow = await db.get(
            `SELECT COUNT(*) AS cnt FROM (
                SELECT user_id FROM checkins WHERE checkin_date >= date('now','localtime','-30 day')
                UNION
                SELECT user_id FROM contribution_logs WHERE created_at >= datetime('now','localtime','-30 day')
             )`
        );
        const taskActive = await db.get(
            `SELECT COUNT(DISTINCT user_id) AS cnt FROM task_claims WHERE status = 'completed'`
        );
        const activeUsers = activeRow?.cnt || 0;
        const taskUsers = taskActive?.cnt || 0;
        const participationRate = activeUsers > 0 ? taskUsers / activeUsers : 0;

        // ---- 贡献点流水（累计） ----
        const flows = await db.get(
            `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_gain,
                    COALESCE(-SUM(CASE WHEN amount < 0 AND type = 'purchase' THEN amount ELSE 0 END), 0) AS total_purchase,
                    COALESCE(-SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS total_outflow
             FROM contribution_logs`
        );
        const totalGain = flows?.total_gain || 0;
        const totalPurchase = flows?.total_purchase || 0;
        const totalOutflow = flows?.total_outflow || 0;
        const consumptionRate = totalGain > 0 ? totalOutflow / totalGain : 0;

        // ---- 近14天流动（用于流通速度 / 总量增速 / 期初存量推算） ----
        const period14 = await db.get(
            `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS gain,
                    COALESCE(-SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS spend
             FROM contribution_logs
             WHERE created_at >= datetime('now','localtime','-13 day')`
        );
        const gain14 = period14?.gain || 0;
        const spend14 = period14?.spend || 0;
        const net14 = gain14 - spend14;
        // 期初存量 = 期末存量 - 期间净流入（无历史快照，由流水反推，口径见页面说明）
        const endSupply = supply?.total_supply || 0;
        const startSupply = Math.max(endSupply - net14, 0);
        const avgSupply = (startSupply + endSupply) / 2;
        const circulationSpeed = avgSupply > 0 ? spend14 / avgSupply : 0;
        const growthRate = startSupply > 0 ? gain14 / startSupply : 0;

        // ---- 基尼系数（按当前余额） ----
        const balances = await db.all('SELECT COALESCE(contribution, 0) AS contribution FROM users');
        const gini = calcGini(balances.map(b => b.contribution));

        // ---- 近7天每日流入/流出 ----
        const dailyFlows = await db.all(
            `SELECT date(created_at) AS d,
                    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS inflow,
                    COALESCE(-SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS outflow
             FROM contribution_logs
             WHERE created_at >= datetime('now','localtime','-6 day')
             GROUP BY d ORDER BY d`
        );

        // ---- 超限预警（方案 4.1：单日≤50、单月≤1500） ----
        const dailyOver = await db.all(
            `SELECT user_id, SUM(amount) AS amt FROM contribution_logs
             WHERE amount > 0 AND created_at >= datetime('now','localtime','start of day')
             GROUP BY user_id HAVING SUM(amount) > 50`
        );
        const monthlyOver = await db.all(
            `SELECT user_id, SUM(amount) AS amt FROM contribution_logs
             WHERE amount > 0 AND created_at >= datetime('now','localtime','start of month')
             GROUP BY user_id HAVING SUM(amount) > 1500`
        );

        // ---- 生态活跃数据 ----
        const eco = await db.get(
            `SELECT (SELECT COUNT(*) FROM checkins) AS checkins,
                    (SELECT COUNT(*) FROM task_claims WHERE status = 'completed') AS tasks_done,
                    (SELECT COUNT(*) FROM contribution_claims) AS claims,
                    (SELECT COUNT(*) FROM transfers) AS transfers,
                    (SELECT COUNT(*) FROM stock_transactions) AS stock_trades,
                    (SELECT COUNT(*) FROM titles WHERE is_active = 1) AS titles,
                    (SELECT COUNT(*) FROM shop_items) AS shop_items`
        );

        // ---- 消费项目价格一览（价格稳定观测：人工核对基准） ----
        const priceItems = await db.all(
            `SELECT '称号' AS kind, name, price FROM titles WHERE is_active = 1 AND in_shop = 1
             UNION ALL
             SELECT '商城' AS kind, name, price FROM shop_items WHERE is_active = 1
             ORDER BY kind, price`
        );

        // ---- 贡献点分布 Top10 ----
        const topHolders = await db.all(
            `SELECT username, nickname, COALESCE(contribution,0) AS contribution
             FROM users WHERE contribution > 0
             ORDER BY contribution DESC LIMIT 10`
        );

        // ---- 页面浏览（近7天） ----
        const pv = await db.all('SELECT date, pv FROM page_views ORDER BY date DESC LIMIT 7');

        // ---- 指标健康判定（试点方案阈值） ----
        const metrics = [
            {
                key: 'participation',
                label: '参与率',
                value: participationRate,
                unit: '%',
                display: (participationRate * 100).toFixed(1),
                healthy: [0.5, 1],     // ≥50%
                warnLow: 0.3,          // <30% 需干预
                desc: '完成≥1次任务的成员数 / 近30天活跃成员数'
            },
            {
                key: 'consumption',
                label: '消费率',
                value: consumptionRate,
                unit: '%',
                display: (consumptionRate * 100).toFixed(1),
                healthy: [0.4, 1],     // ≥40%
                warnLow: 0.2,          // <20%
                desc: '累计流出（商城/任务/转账等）/ 累计获得（流水口径）'
            },
            {
                key: 'velocity',
                label: '流通速度',
                value: circulationSpeed,
                unit: '次/周期',
                display: circulationSpeed.toFixed(2),
                healthy: [1, 3],       // 1–3 次/周期
                warnLow: 0.5,          // <0.5 沉睡
                desc: '近14天流出 / 平均流通存量（期初存量由流水反推）'
            },
            {
                key: 'growth',
                label: '总量增速',
                value: growthRate,
                unit: '%',
                display: (growthRate * 100).toFixed(1),
                healthy: [0, 0.3],     // ≤30%/月
                warnLow: null,
                desc: '近14天新增 / 期初存量'
            },
            {
                key: 'gini',
                label: '基尼系数',
                value: gini,
                unit: '',
                display: gini.toFixed(3),
                healthy: [0.3, 0.5],
                warnHigh: 0.6,         // >0.6 垄断
                desc: '按成员当前持有量计算洛伦兹曲线面积比'
            },
            {
                key: 'price',
                label: '价格稳定',
                value: null,
                unit: '',
                display: '人工监测',
                healthy: null,
                warnLow: null,
                warnHigh: null,
                desc: '兑换项价格无变动，黑市价需线下核验'
            }
        ].map(m => {
            if (m.value === null) return { ...m, status: 'manual' };
            let status = 'normal';
            const isWarn = (m.warnLow !== null && m.value < m.warnLow) || (m.warnHigh !== null && m.value > m.warnHigh);
            if (isWarn) status = 'warn';
            else if (m.healthy && (m.value < m.healthy[0] || m.value > m.healthy[1])) status = 'watch';
            return { ...m, status };
        });

        res.json({
            generatedAt: new Date().toISOString(),
            metrics,
            totals: {
                totalUsers: supply?.total_users || 0,
                holders: supply?.holders || 0,
                totalSupply: endSupply,
                totalGain,
                totalPurchase,
                totalOutflow,
                startSupply,
                activeUsers
            },
            dailyFlows,
            overLimit: { daily: dailyOver, monthly: monthlyOver },
            eco,
            priceItems,
            topHolders,
            pageViews: pv
        });
    } catch (error) {
        logger.error('获取经济看板错误:', { message: error.message, stack: error.stack });
        res.status(500).json({ error: '获取经济数据失败' });
    }
});

// 导出 xlsx：贡献点总览表 + 账户余额公示（支持自选时间段，缺省本周）
router.get('/export', async (req, res) => {
    try {
        const { start, end } = req.query;

        // 时间段解析（缺省本周一 00:00 ~ 现在）
        let startDate, endDate;
        if (start && end) {
            startDate = new Date(`${start}T00:00:00`);
            endDate = new Date(`${end}T23:59:59`);
        } else {
            const now = new Date();
            const day = now.getDay(); // 0=周日
            const diff = day === 0 ? 6 : day - 1; // 距周一的天数
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff, 0, 0, 0);
            endDate = now;
        }
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ error: '时间格式错误，应为 YYYY-MM-DD' });
        }
        const startStr = toLocalStr(startDate);
        const endStr = toLocalStr(endDate);

        // 1. 时间段内新增/消费
        const flow = await db.get(
            `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS gain,
                    COALESCE(-SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS spend
             FROM contribution_logs
             WHERE created_at >= ? AND created_at <= ?`,
            [startStr, endStr]
        );

        // 2. 当前流通总量 + 持有人
        const supply = await db.get(
            `SELECT COALESCE(SUM(contribution), 0) AS total_supply,
                    COUNT(CASE WHEN COALESCE(contribution,0) > 0 THEN 1 END) AS holders
             FROM users`
        );

        // 3. 全员账户余额（仅余额，不含消费明细）
        const accounts = await db.all(
            `SELECT username, nickname, COALESCE(contribution, 0) AS contribution
             FROM users
             ORDER BY contribution DESC, id ASC`
        );

        const gain = flow?.gain || 0;
        const spend = flow?.spend || 0;
        const totalSupply = supply?.total_supply || 0;
        const holders = supply?.holders || 0;

        // 4. 生成 xlsx
        const wb = XLSX.utils.book_new();
        const rangeText = `${startStr.slice(0, 10)} ~ ${endStr.slice(0, 10)}`;

        // Sheet 1：贡献点总览表
        const ws1 = XLSX.utils.aoa_to_sheet([
            ['贡献点总览表'],
            [`统计时间段：${rangeText}`],
            [],
            ['指标', '数值'],
            ['本期新增总量', gain],
            ['本期消费总量', spend],
            ['本期净增长', gain - spend],
            ['当前流通总量', totalSupply],
            ['持有贡献点成员数', holders]
        ]);
        ws1['!cols'] = [{ wch: 22 }, { wch: 16 }];
        XLSX.utils.book_append_sheet(wb, ws1, '贡献点总览表');

        // Sheet 2：账户余额公示
        const accountRows = [
            ['账户余额公示（仅余额，不含消费明细）'],
            [`统计时间：${endStr.slice(0, 10)}`],
            [],
            ['序号', '用户名', '昵称', '贡献点余额']
        ];
        accounts.forEach((a, i) => {
            accountRows.push([i + 1, a.username, a.nickname || '', a.contribution]);
        });
        const ws2 = XLSX.utils.aoa_to_sheet(accountRows);
        ws2['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 20 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws2, '账户余额公示');

        // 5. 返回文件
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const filename = `贡献点总览-${startStr.slice(0, 10)}_${endStr.slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.send(buf);
    } catch (error) {
        logger.error('导出经济数据错误:', error);
        res.status(500).json({ error: '导出失败' });
    }
});

module.exports = router;
