// 迁移：捐赠墙（公账）+ 修复气泡购买
//  1) contribution_logs 的 type CHECK 白名单补 'bubble'（修复「无法购买气泡」）与 'donation'（捐赠发放贡献点）
//  2) 新建 donation_ledger 表：公账出入账明细（入账=捐赠；支出）
//  3) 索引
// 用法：先备份数据库，再执行 node scripts/migrate-20260918-donation.js
const path = require('path');
const db = require(path.join(__dirname, '..', 'database'));

// 现有白名单 + 新增两项（顺序与原表保持一致，追加在末尾）
const TYPES = [
    'claim', 'task', 'transfer_in', 'transfer_out', 'purchase', 'reward', 'admin',
    'player_task', 'transfer', 'title', 'discipline', 'post', 'exchange', 'payment',
    'bubble',   // 购买聊天气泡
    'donation', // 捐赠按比例发放的贡献点
];

(async () => {
    try {
        // ---- 1) contribution_logs 白名单 ----
        const cur = await db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='contribution_logs'`);
        const needBubble = !cur?.sql?.includes("'bubble'");
        const needDonation = !cur?.sql?.includes("'donation'");

        if (!needBubble && !needDonation) {
            console.log('[跳过] contribution_logs 已含 bubble / donation');
        } else {
            await db.run('ALTER TABLE contribution_logs RENAME TO contribution_logs_old');
            await db.run(`CREATE TABLE contribution_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN (${TYPES.map(t => `'${t}'`).join(', ')})),
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
            const n = await db.get('SELECT COUNT(*) AS c FROM contribution_logs');
            const added = [needBubble ? 'bubble' : null, needDonation ? 'donation' : null].filter(Boolean).join(' + ');
            console.log(`[完成] contribution_logs 白名单已扩展（${added}），现有 ${n.c} 条记录`);
        }

        // ---- 2) donation_ledger 公账明细 ----
        await db.run(`CREATE TABLE IF NOT EXISTS donation_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            direction TEXT NOT NULL CHECK (direction IN ('in','out')),
            user_id INTEGER,
            amount REAL NOT NULL DEFAULT 0,
            ratio REAL DEFAULT 0,
            points REAL DEFAULT 0,
            purpose TEXT,
            note TEXT,
            occurred_on DATE NOT NULL,
            is_public INTEGER DEFAULT 1,
            materials TEXT DEFAULT '[]',
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        console.log('[完成] donation_ledger 表就绪');

        // ---- 3) 索引 ----
        await db.run('CREATE INDEX IF NOT EXISTS idx_donation_occurred ON donation_ledger(occurred_on, id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_donation_user ON donation_ledger(user_id, direction)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_donation_dir ON donation_ledger(direction)');
        console.log('[完成] 索引就绪');

        const summary = await db.get(`SELECT
            COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS income,
            COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS expense,
            COUNT(*) AS n FROM donation_ledger`);
        console.log(`[完成] 迁移成功。公账：收入 ${summary.income} / 支出 ${summary.expense} / 余额 ${(summary.income - summary.expense).toFixed(2)}（${summary.n} 条）`);
    } catch (e) {
        console.error('[失败] 迁移:', e.message);
        process.exit(1);
    } finally {
        db.close();
    }
})();
