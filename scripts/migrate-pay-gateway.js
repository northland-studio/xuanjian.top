/**
 * 迁移：外部站点贡献点兑换支付网关
 * 1) contribution_logs.type CHECK 扩展加入 'exchange'（外站兑换）
 * 2) 新建 pay_sites 表（外站站点与密钥）
 * 3) 新建 pay_orders 表（兑换/支付单，幂等 + 状态机 + 回调状态）
 * 4) 新建 pay_logs 表（兑换关键操作审计日志）
 * 幂等：可重复执行。用法：先备份，再 node scripts/migrate-pay-gateway.js
 */
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));

const ALL_TYPES = ['claim', 'task', 'transfer_in', 'transfer_out', 'purchase', 'reward', 'admin', 'player_task', 'transfer', 'title', 'discipline', 'post', 'exchange'];

(async () => {
    try {
        await db.run('PRAGMA busy_timeout = 10000');

        // ---- 1) contribution_logs CHECK 扩展 ----
        const cur = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='contribution_logs'`);
        if (cur?.sql?.includes("'exchange'")) {
            console.log('[contribution_logs] 已含 exchange，跳过重建');
        } else {
            const checkStr = ALL_TYPES.map(t => `'${t}'`).join(', ');
            await db.run('ALTER TABLE contribution_logs RENAME TO contribution_logs_old');
            await db.run(`CREATE TABLE contribution_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN (${checkStr})),
                ref_id INTEGER DEFAULT 0,
                note TEXT,
                balance_after INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`);
            await db.run(`INSERT INTO contribution_logs (id, user_id, amount, type, ref_id, note, balance_after, created_at)
                SELECT id, user_id, amount, type, ref_id, note, balance_after, created_at FROM contribution_logs_old`);
            await db.run('DROP TABLE contribution_logs_old');
            await db.run('CREATE INDEX IF NOT EXISTS idx_contribution_logs_user ON contribution_logs(user_id, created_at)');
            console.log('[contribution_logs] CHECK 已扩展 -> exchange');
        }

        // ---- 2) pay_sites 外站站点 ----
        await db.run(`CREATE TABLE IF NOT EXISTS pay_sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            site_url TEXT,
            api_key TEXT UNIQUE NOT NULL,
            hmac_secret TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            callback_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('[pay_sites] 表就绪');

        // ---- 3) pay_orders 兑换单 ----
        await db.run(`CREATE TABLE IF NOT EXISTS pay_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_id INTEGER NOT NULL,
            site_order_no TEXT NOT NULL,
            order_no TEXT UNIQUE NOT NULL,
            user_id INTEGER,
            site_user_id TEXT,
            amount INTEGER NOT NULL DEFAULT 0,
            direction TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('in','out')),
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','fail','expired')),
            verify_code TEXT,
            notified INTEGER DEFAULT 0,
            notify_count INTEGER DEFAULT 0,
            notify_response TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            handled_at DATETIME,
            FOREIGN KEY (site_id) REFERENCES pay_sites(id),
            UNIQUE(site_id, site_order_no)
        )`);
        await db.run('CREATE INDEX IF NOT EXISTS idx_pay_orders_site ON pay_orders(site_id, status)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_pay_orders_user ON pay_orders(user_id, created_at)');
        console.log('[pay_orders] 表就绪');

        // ---- 4) pay_logs 兑换审计日志（独立于业务流水，记录对账/关键动作） ----
        await db.run(`CREATE TABLE IF NOT EXISTS pay_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT,
            site_id INTEGER,
            action TEXT,
            detail TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await db.run('CREATE INDEX IF NOT EXISTS idx_pay_logs_order ON pay_logs(order_no)');
        console.log('[pay_logs] 表就绪');

        console.log('[完成] 支付网关迁移成功');
        db.close();
        process.exit(0);
    } catch (e) {
        console.error('[失败] 迁移:', e.message);
        process.exit(1);
    }
})();
