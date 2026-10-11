/**
 * 「紫雪坊市公会集市」迁移 v1
 *
 * 用法：
 *   node scripts/migrate-marketplace.js --dry-run   # 只看会做什么
 *   node scripts/migrate-marketplace.js             # 执行（自动先备份数据库文件）
 *   DB_FILE=data/wiki-mobile-test.db node scripts/migrate-marketplace.js
 *
 * 做七件事（幂等，可重复执行）：
 *  1. 备份 data/*.db 到 data/backups/（SQLite 用 VACUUM INTO 生成一致性快照）
 *  2. 扩展 contribution_logs.type 白名单（新增集市相关 5 种；重建表，逐行校验）
 *  3. 扩展 notifications.type 白名单（新增集市通知 4 种；重建表，逐行校验）
 *  4. 建集市业务表（店铺/位置/分类/商品/图片/订单/核销码/费用/分户账/评价/收藏/争议/短链/档案/通知事件）
 *  5. 写入默认配置 settings.market_config（费率、周期、宽限期、限购、地图范围等）
 *  6. 建托管系统账号 market_escrow（下单→确认收货之间的资金中间态），并把头像同步成公会官方账号同款
 *  7. 清理已废弃的公会财政账号 market_treasury（公会不持有余额账号，收入只走 market_finance_ledger）
 *
 * 设计要点（与官网现有系统保持一致）：
 *  - 余额只有一个真相来源：users.contribution；集市所有资金变动都走它 + contribution_logs
 *  - 不新增"平台服务费"科目，只有 开店费 / 续期费 / 交易税 三类
 *  - 公会收入只以分户账 market_finance_ledger 记账（in=收入即钱退出流通，out=冲回），**没有公会余额账号**
 *  - 税率用整数基点（bp，1bp = 0.01%）存储，避免浮点
 *  - 核销码只存 sha256 哈希 + 末 4 位，不长期留明文
 *  - 托管账号 level=-1：排行榜/成员列表按 level>=0 过滤，天然不会带出系统账号
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'database'));

const DRY = process.argv.includes('--dry-run');
const DB_FILE = process.env.DB_FILE ? path.resolve(ROOT, process.env.DB_FILE) : path.join(ROOT, 'data', 'guild.db');

/* ---------------- 1. 配置默认值 ---------------- */

const DEFAULT_CONFIG = {
    // 开店费
    openFeeEnabled: true,
    openFee: 5,
    openFeeFirstFree: true,          // 首家店免开店费
    // 续期费
    renewFeeEnabled: true,
    renewFee: 2,
    cyclePreset: 'monthly',          // daily|weekly|monthly|quarterly|yearly|custom
    cycleDays: 30,                   // custom 时生效
    graceDays: 7,                    // 续费失败后的宽限期
    remindBeforeDays: 3,             // 到期前提醒
    autoPauseAfterGrace: true,       // 宽限期结束自动暂停并下架
    // 交易税（无平台抽成）
    taxEnabled: true,
    taxRateBp: 500,                  // 500 bp = 5.00%
    taxMode: 'merchant',             // merchant=商家承担 / buyer=买家承担
    taxRounding: 'round',            // round|floor|ceil（对 0.01 精度取整）
    // 交易限额
    maxOpenStoresPerUser: 1,
    perOrderLimitDefault: 10,
    maxProductsPerStore: 50,
    verifyCodeTtlHours: 72,          // 核销码有效期
    autoConfirmDays: 7,              // 商家标记履约后 N 天自动确认收货（0=不自动）
    // 地图（X/Z 投影）
    mapRange: {
        // 每个服务器的基础范围；没有单配的用 default
        default: { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000, flipZ: true }
    },
    mapBackgrounds: {},              // { 'serverKey|dimension': { url, minX, maxX, minZ, maxZ } }
    // 其它
    reviewRequireOrder: true,
    storeReviewRequired: true
};

const CONTRIBUTION_TYPES = [
    'claim', 'task', 'transfer_in', 'transfer_out', 'purchase', 'reward', 'admin', 'player_task',
    'transfer', 'title', 'discipline', 'post', 'exchange', 'payment', 'bubble', 'donation', 'pay_out', 'pay_in',
    // 集市新增
    'market_escrow_in',   // 买家付款进入托管
    'market_escrow_out',  // 托管转出（结算给商家 / 退款给买家）
    'market_sale',        // 商家销售收入
    'market_tax',         // 交易税入公会财政分户账
    'market_fee',         // 开店费/续期费
    'market_refund',      // 退款到买家
    'market_adjust'       // 管理员手工调账
];

const NOTIFICATION_TYPES = [
    'post_daily', 'post_decision', 'comment', 'like', 'claim_result', 'task_reward', 'transfer',
    'favorite', 'follow', 'purchase', 'discipline', 'player_task', 'chat', 'chat_mention', 'pay',
    'system', 'title_grant', 'wiki',
    // 集市新增
    'market_store',    // 店铺申请/审核/状态/到期/欠费
    'market_order',    // 订单全流程
    'market_fee',      // 费用扣款
    'market_review',   // 评价
    'market_dispute'   // 争议裁决
];

const CONTRIB_LOG_COLUMNS = 'id, user_id, amount, type, ref_id, note, balance_after, created_at';
const NOTIF_COLUMNS = 'id, user_id, type, title, content, post_id, comment_id, actor_id, is_read, created_at';

/* ---------------- 2. 建表语句 ---------------- */

const BUILD = [
    /* 店铺 */
    `CREATE TABLE IF NOT EXISTS market_stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        intro TEXT DEFAULT '',
        category_id INTEGER DEFAULT NULL,
        tags TEXT DEFAULT '[]',
        cover TEXT DEFAULT '',
        avatar TEXT DEFAULT '',
        notice TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','active','paused','grace','suspended','closed','rejected')),
        review_note TEXT DEFAULT '',
        reviewed_by INTEGER DEFAULT NULL,
        reviewed_at DATETIME DEFAULT NULL,
        open_fee_paid REAL DEFAULT 0,
        cycle_days INTEGER DEFAULT 30,
        expire_at DATETIME DEFAULT NULL,
        grace_until DATETIME DEFAULT NULL,
        next_fee_at DATETIME DEFAULT NULL,
        last_fee_at DATETIME DEFAULT NULL,
        fee_fail_count INTEGER DEFAULT 0,
        auto_paused INTEGER DEFAULT 0,
        rating_sum INTEGER DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        sales_count INTEGER DEFAULT 0,
        order_count INTEGER DEFAULT 0,
        dispute_count INTEGER DEFAULT 0,
        is_featured INTEGER DEFAULT 0,
        archive_no TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_stores_status ON market_stores(status, is_featured DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_market_stores_owner ON market_stores(owner_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_market_stores_expire ON market_stores(status, next_fee_at)`,

    /* 店铺位置 */
    `CREATE TABLE IF NOT EXISTS market_store_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        server_key TEXT NOT NULL,
        server_name TEXT DEFAULT '',
        dimension TEXT NOT NULL DEFAULT 'overworld'
            CHECK (dimension IN ('overworld','nether','end','custom')),
        dimension_custom TEXT DEFAULT '',
        x REAL NOT NULL DEFAULT 0,
        y REAL DEFAULT 64,
        z REAL NOT NULL DEFAULT 0,
        label TEXT DEFAULT '',
        note TEXT DEFAULT '',
        is_public INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_loc_store ON market_store_locations(store_id)`,
    `CREATE INDEX IF NOT EXISTS idx_market_loc_map ON market_store_locations(server_key, dimension, is_public)`,

    /* 分类（店铺分类与商品分类共用） */
    `CREATE TABLE IF NOT EXISTS market_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('store','product')),
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        icon TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_market_cat_kind_slug ON market_categories(kind, slug)`,

    /* 商品 */
    `CREATE TABLE IF NOT EXISTS market_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT DEFAULT '',
        description TEXT DEFAULT '',
        category_id INTEGER DEFAULT NULL,
        tags TEXT DEFAULT '[]',
        cover TEXT DEFAULT '',
        price REAL NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        sold INTEGER NOT NULL DEFAULT 0,
        per_order_limit INTEGER DEFAULT 0,
        per_user_limit INTEGER DEFAULT 0,
        spec TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft','on','off','soldout','removed')),
        off_reason TEXT DEFAULT '',
        views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_products_store ON market_products(store_id, status, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_market_products_list ON market_products(status, category_id, price)`,
    `CREATE INDEX IF NOT EXISTS idx_market_products_hot ON market_products(status, sold DESC, id DESC)`,

    `CREATE TABLE IF NOT EXISTS market_product_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_pimg ON market_product_images(product_id, sort_order)`,

    /* 订单 */
    `CREATE TABLE IF NOT EXISTS market_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT UNIQUE NOT NULL,
        idem_key TEXT UNIQUE,
        buyer_id INTEGER NOT NULL,
        store_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_payment'
            CHECK (status IN ('pending_payment','paid','delivered','awaiting_confirm','settled','cancelled','refunding','refunded','disputed','expired')),
        amount REAL NOT NULL DEFAULT 0,          -- 商品成交额（不含买家承担的税）
        discount REAL NOT NULL DEFAULT 0,
        tax_base REAL NOT NULL DEFAULT 0,        -- 计税基数
        tax_rate_bp INTEGER NOT NULL DEFAULT 0,  -- 税率快照（基点）
        tax_mode TEXT NOT NULL DEFAULT 'merchant',
        tax_amount REAL NOT NULL DEFAULT 0,
        buyer_pay REAL NOT NULL DEFAULT 0,       -- 买家实付
        merchant_income REAL NOT NULL DEFAULT 0, -- 商家应得
        snapshot TEXT DEFAULT '[]',              -- 商品快照 JSON
        close_reason TEXT DEFAULT '',
        idem_created INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME DEFAULT NULL,
        verified_at DATETIME DEFAULT NULL,
        verified_by INTEGER DEFAULT NULL,
        delivered_at DATETIME DEFAULT NULL,
        confirmed_at DATETIME DEFAULT NULL,
        settled_at DATETIME DEFAULT NULL,
        refunded_at DATETIME DEFAULT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_orders_buyer ON market_orders(buyer_id, status, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_market_orders_store ON market_orders(store_id, status, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_market_orders_status ON market_orders(status, updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_market_orders_created ON market_orders(created_at DESC)`,

    `CREATE TABLE IF NOT EXISTS market_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        store_id INTEGER NOT NULL,
        title_snapshot TEXT NOT NULL,
        price_snapshot REAL NOT NULL,
        spec_snapshot TEXT DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 1,
        subtotal REAL NOT NULL DEFAULT 0,
        cover_snapshot TEXT DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_oitems_order ON market_order_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_market_oitems_product ON market_order_items(product_id)`,

    /* 核销码（只存哈希） */
    `CREATE TABLE IF NOT EXISTS market_verify_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL UNIQUE,
        code_hash TEXT NOT NULL UNIQUE,
        code_tail TEXT NOT NULL DEFAULT '',
        expires_at DATETIME NOT NULL,
        used_at DATETIME DEFAULT NULL,
        used_by INTEGER DEFAULT NULL,
        failed_attempts INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_codes_hash ON market_verify_codes(code_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_market_codes_expire ON market_verify_codes(expires_at)`,

    /* 开店费/续期费扣费记录（幂等） */
    `CREATE TABLE IF NOT EXISTS market_fee_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        owner_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('open','renew')),
        amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','failed','waived','refunded')),
        fail_reason TEXT DEFAULT '',
        period_from DATETIME DEFAULT NULL,
        period_to DATETIME DEFAULT NULL,
        idem_key TEXT UNIQUE,
        operator_id INTEGER DEFAULT NULL,
        note TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_fee_store ON market_fee_ledger(store_id, kind, created_at DESC)`,

    /* 公会收入分户账（公会不持有余额账号：in=收入即钱退出流通，out=冲回；固定三类收入 + 调账）
       refund_tax 预留给「已结算订单被人工追回税款」的场景，正常流程不写入 */
    `CREATE TABLE IF NOT EXISTS market_finance_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('tax','open_fee','renew_fee','refund_fee','refund_tax','adjust')),
        direction TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
        amount REAL NOT NULL DEFAULT 0,
        order_id INTEGER DEFAULT NULL,
        store_id INTEGER DEFAULT NULL,
        from_user_id INTEGER DEFAULT NULL,
        balance_after REAL DEFAULT 0,
        tax_mode TEXT DEFAULT '',
        tax_rate_bp INTEGER DEFAULT 0,
        note TEXT DEFAULT '',
        operator_id INTEGER DEFAULT NULL,
        idem_key TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_fin_kind ON market_finance_ledger(kind, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_market_fin_order ON market_finance_ledger(order_id)`,

    /* 评价（一单一评） */
    `CREATE TABLE IF NOT EXISTS market_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL UNIQUE,
        store_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL,
        rating INTEGER NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
        content TEXT DEFAULT '',
        reply TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_reviews_store ON market_reviews(store_id, status, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_market_reviews_product ON market_reviews(product_id, status, id DESC)`,

    /* 收藏（店铺/商品） */
    `CREATE TABLE IF NOT EXISTS market_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('store','product')),
        target_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_market_fav_unique ON market_favorites(user_id, target_type, target_id)`,
    `CREATE INDEX IF NOT EXISTS idx_market_fav_user ON market_favorites(user_id, created_at DESC)`,

    /* 争议 */
    `CREATE TABLE IF NOT EXISTS market_disputes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        opened_by INTEGER NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved_buyer','resolved_merchant','closed')),
        resolution TEXT DEFAULT '',
        refund_amount REAL DEFAULT 0,
        handled_by INTEGER DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME DEFAULT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_disputes ON market_disputes(status, created_at DESC)`,

    /* 退款申请 */
    `CREATE TABLE IF NOT EXISTS market_refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL,
        store_id INTEGER NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        reason TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','done')),
        handled_by INTEGER DEFAULT NULL,
        handle_note TEXT DEFAULT '',
        idem_key TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        handled_at DATETIME DEFAULT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_refunds_store ON market_refunds(store_id, status, created_at DESC)`,

    /* 短链（二维码指向） */
    `CREATE TABLE IF NOT EXISTS market_short_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('store','product','map')),
        target_id INTEGER NOT NULL,
        hit_count INTEGER DEFAULT 0,
        disabled INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_short_target ON market_short_links(target_type, target_id)`,

    /* 档案（用户选定：只把商铺信息 + 新增贡献点出入类型纳入档案） */
    `CREATE TABLE IF NOT EXISTS market_archives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        archive_no TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('store','ledger')),
        ref_type TEXT NOT NULL DEFAULT '',
        ref_id INTEGER DEFAULT NULL,
        title TEXT NOT NULL,
        summary TEXT DEFAULT '',
        payload TEXT DEFAULT '{}',
        created_by INTEGER DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_archives_kind ON market_archives(kind, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_market_archives_ref ON market_archives(ref_type, ref_id)`,

    /* 通知事件（Outbox：事务成功后投递，幂等 + 重试 + 去重） */
    `CREATE TABLE IF NOT EXISTS market_notify_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        order_id INTEGER DEFAULT NULL,
        store_id INTEGER DEFAULT NULL,
        user_id INTEGER DEFAULT NULL,
        payload TEXT DEFAULT '{}',
        channels TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
        attempts INTEGER DEFAULT 0,
        last_error TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME DEFAULT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_notify_status ON market_notify_events(status, id)`,
    `CREATE INDEX IF NOT EXISTS idx_market_notify_order ON market_notify_events(order_id)`,

    /* 审计日志（费率/税务/退款/封禁等敏感操作） */
    `CREATE TABLE IF NOT EXISTS market_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        target_type TEXT DEFAULT '',
        target_id INTEGER DEFAULT NULL,
        operator_id INTEGER DEFAULT NULL,
        before_json TEXT DEFAULT '',
        after_json TEXT DEFAULT '',
        reason TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_market_audit ON market_audit_logs(action, created_at DESC)`
];

/* ---------------- 3. 工具 ---------------- */

function backupDb() {
    const dir = path.join(path.dirname(DB_FILE), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const dest = path.join(dir, `${path.basename(DB_FILE)}.pre-marketplace-${stamp}.bak`);
    return { dir, dest };
}

async function rebuildWhitelist({ table, column, types, columns, probeType, probeSql }) {
    const before = await db.get(`SELECT COUNT(*) AS c FROM ${table}`);
    const tmp = `${table}_new`;
    await db.transaction(async () => {
        await db.run(`DROP TABLE IF EXISTS ${tmp}`);
        let sql = await db.get(`SELECT sql FROM sqlite_master WHERE name = ?`, [table]);
        if (!sql) throw new Error(`${table} 不存在`);
        // 用原表 DDL 换掉 CHECK 白名单，保持其它定义不动
        const newSql = sql.sql
            .replace(new RegExp(`${table}\\b`, 'g'), tmp)
            .replace(/CHECK\s*\(\s*type\s+IN\s*\([^)]*\)\s*\)/i, `CHECK (type IN (${types.map(t => `'${t}'`).join(', ')}))`);
        await db.run(newSql);
        await db.run(`INSERT INTO ${tmp} (${columns}) SELECT ${columns} FROM ${table}`);
        await db.run(`DROP TABLE ${table}`);
        await db.run(`ALTER TABLE ${tmp} RENAME TO ${table}`);
    });
    const after = await db.get(`SELECT COUNT(*) AS c FROM ${table}`);
    const ok = Number(after.c) === Number(before.c);
    console.log(`  ${table}.${column} 白名单扩展：${before.c} → ${after.c} ${ok ? '✓' : '✗ 行数不一致！'}`);
    if (!ok) throw new Error(`${table} 重建后行数不一致，已停止`);
    // 探针：新类型确实可写入（每张表列不同，用各自的探针语句）
    try {
        const r = await db.run(probeSql, [probeType]);
        await db.run(`DELETE FROM ${table} WHERE id = ?`, [r.id]);
        console.log(`  探针：'${probeType}' 可写入 ✓`);
    } catch (e) {
        throw new Error(`探针失败：'${probeType}' 仍不可写入 → ${e.message}`);
    }
}

/* ---------------- 4. 主流程 ---------------- */

(async () => {
    console.log(`库：${path.relative(ROOT, DB_FILE)}${DRY ? '（DRY-RUN，不会改动）' : ''}`);

    if (DRY) {
        console.log('将执行：备份 → 扩展 contribution_logs/notifications 白名单 → 建集市表 → 写默认配置 → 建托管账号+同步头像 → 清理废弃的公会财政账号');
        for (const sql of BUILD) {
            const m = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql);
            if (m) console.log('  + ' + m[1]);
        }
        return process.exit(0);
    }

    const { dest } = backupDb();
    fs.copyFileSync(DB_FILE, dest);
    console.log(`✓ 已备份：${path.relative(ROOT, dest)}`);

    // 2/3 白名单
    console.log('扩展白名单：');
    await rebuildWhitelist({
        table: 'contribution_logs', column: 'type', types: CONTRIBUTION_TYPES,
        columns: CONTRIB_LOG_COLUMNS, probeType: 'market_escrow_in',
        probeSql: `INSERT INTO contribution_logs (user_id, amount, type, note) VALUES (1, 0, ?, '__mkt_selfcheck__')`
    });
    await rebuildWhitelist({
        table: 'notifications', column: 'type', types: NOTIFICATION_TYPES,
        columns: NOTIF_COLUMNS, probeType: 'market_order',
        probeSql: `INSERT INTO notifications (user_id, type, title, content) VALUES (1, ?, '__mkt_selfcheck__', '迁移自检')`
    });

    // 4 建表
    console.log('建表：');
    // market_orders 的状态白名单若还是早期版本（缺 awaiting_confirm），直接重建（该表在任何环境都还没有数据）
    const orderSql = await db.get(`SELECT sql FROM sqlite_master WHERE name = 'market_orders'`);
    if (orderSql && !/awaiting_confirm/.test(orderSql.sql)) {
        const n = await db.get('SELECT COUNT(*) AS c FROM market_orders');
        if (Number(n.c) > 0) throw new Error(`market_orders 为早期结构且有 ${n.c} 行数据，拒绝自动重建`);
        await db.run('DROP TABLE market_orders');
        console.log('  · market_orders 为早期状态白名单，已删除空表后重建');
    }
    let created = 0;
    for (const sql of BUILD) {
        await db.run(sql);
        const m = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql);
        if (m) { created++; process.stdout.write('  + ' + m[1] + '\n'); }
    }
    console.log(`  共 ${created} 张表 + 索引 ✓`);

    // 4b market_finance_ledger 早期 CHECK 缺 'refund_fee' 时重建（只换白名单，逐行拷贝并校验）
    const finSql = await db.get(`SELECT sql FROM sqlite_master WHERE name = 'market_finance_ledger'`);
    if (finSql && !/refund_fee/.test(finSql.sql)) {
        const before = await db.get('SELECT COUNT(*) AS c FROM market_finance_ledger');
        const cols = (await db.all(`PRAGMA table_info(market_finance_ledger)`)).map(c => c.name);
        const newDdl = BUILD.map(s => /CREATE TABLE IF NOT EXISTS market_finance_ledger/.test(s) ? s : null).find(Boolean);
        await db.transaction(async () => {
            await db.run('DROP TABLE IF EXISTS market_finance_ledger_new');
            await db.run(newDdl.replace('market_finance_ledger', 'market_finance_ledger_new'));
            await db.run(`INSERT INTO market_finance_ledger_new (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM market_finance_ledger`);
            await db.run('DROP TABLE market_finance_ledger');
            await db.run('ALTER TABLE market_finance_ledger_new RENAME TO market_finance_ledger');
            await db.run('CREATE INDEX IF NOT EXISTS idx_market_fin_kind ON market_finance_ledger(kind, created_at DESC)');
            await db.run('CREATE INDEX IF NOT EXISTS idx_market_fin_order ON market_finance_ledger(order_id)');
        });
        const after = await db.get('SELECT COUNT(*) AS c FROM market_finance_ledger');
        const ok = Number(after.c) === Number(before.c);
        console.log(`  · market_finance_ledger 白名单补 refund_fee：${before.c} → ${after.c} ${ok ? '✓' : '✗ 行数不一致！'}`);
        if (!ok) throw new Error('market_finance_ledger 重建后行数不一致，已停止');
    }

    // 5 默认配置
    const exist = await db.get('SELECT value FROM settings WHERE key = ?', ['market_config']);
    if (!exist) {
        await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
            ['market_config', JSON.stringify(DEFAULT_CONFIG), new Date().toISOString().slice(0, 19).replace('T', ' ')]);
        console.log('✓ 写入默认配置 settings.market_config');
    } else {
        console.log('· market_config 已存在，保持不动（如需重置请手工改）');
    }

    // 6 托管账号
    let escrow = await db.get('SELECT id, avatar FROM users WHERE username = ?', ['market_escrow']);
    if (!escrow) {
        const r = await db.run(
            `INSERT INTO users (username, nickname, password, level, contribution, email_verified, password_set)
             VALUES ('market_escrow', '集市托管账户', ?, -1, 0, 0, 0)`,
            [crypto.randomBytes(24).toString('hex')]
        );
        escrow = { id: r.id, avatar: '' };
        console.log(`✓ 已创建托管账号 market_escrow（id=${r.id}，level=-1 不出现在排行榜/成员列表）`);
    } else {
        console.log(`· 托管账号已存在（id=${escrow.id}）`);
    }

    // 6b 托管账号头像：与公会官方账号（id=1）同款。
    //    线上 users.avatar 无唯一约束（默认头像被 18 个账号共用），直接复用 URL 即可，无需另传七牛。
    if (!String(escrow.avatar || '').trim() || /default-avatar/.test(String(escrow.avatar))) {
        const src = await db.get(
            `SELECT avatar FROM users WHERE COALESCE(avatar, '') <> '' AND (username = 'xuanjian_guild' OR id = 1)
             ORDER BY (username = 'xuanjian_guild') DESC, id ASC LIMIT 1`);
        const avatar = src ? String(src.avatar || '').trim() : '';
        if (avatar) {
            await db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatar, escrow.id]);
            console.log(`✓ 托管账号头像已同步为公会官方账号同款：${avatar}`);
        } else {
            console.log('· 公会官方账号没有头像，托管账号保留默认头像');
        }
    } else {
        console.log(`· 托管账号已有头像（${escrow.avatar}），保持不动`);
    }

    // 7 清理已废弃的公会财政账号 market_treasury（公会不持有余额账号）
    const tr = await db.get(`SELECT id, username, contribution FROM users WHERE username = 'market_treasury'`);
    if (!tr) {
        console.log('· 无残留的公会财政账号 market_treasury ✓');
    } else if (Number(tr.contribution || 0) !== 0) {
        throw new Error(`market_treasury（id=${tr.id}）余额为 ${tr.contribution}，拒绝删除：请先把余额清零或说明处置方式`);
    } else {
        // 先清掉引用它的行（contribution_logs / notifications 等有 FK），再删账号；删除前留一条审计痕迹
        const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
        let cleaned = 0;
        await db.run(
            `INSERT INTO market_audit_logs (action, target_type, target_id, operator_id, before_json, after_json, reason, created_at)
             VALUES ('treasury_account_purged', 'user', ?, NULL, ?, ?, ?, datetime('now','localtime'))`,
            [tr.id, JSON.stringify({ id: tr.id, username: tr.username, contribution: tr.contribution }),
                JSON.stringify({ removed: true }), '公会不设余额账号，收入只记 market_finance_ledger']
        );
        await db.transaction(async () => {
            for (const t of tables) {
                if (t.name === 'users') continue;
                const fks = await db.all(`PRAGMA foreign_key_list(${t.name})`);
                const cols = [...new Set(fks.filter(f => f.table === 'users' && f.to === 'id').map(f => f.from))];
                for (const c of cols) {
                    const r = await db.run(`DELETE FROM ${t.name} WHERE ${c} = ?`, [tr.id]);
                    cleaned += r.changes || 0;
                }
            }
            await db.run('DELETE FROM users WHERE id = ?', [tr.id]);
        });
        console.log(`✓ 已删除公会财政账号 market_treasury（id=${tr.id}，连带清理引用行 ${cleaned} 条，审计已留痕）`);
    }

    // 分类种子
    const catCount = await db.get(`SELECT COUNT(*) AS c FROM market_categories`);
    if (Number(catCount.c) === 0) {
        const seeds = [
            ['store', '杂货铺', 'general', '🏪', 1], ['store', '装备与工具', 'gear', '⚔', 2],
            ['store', '建材与装饰', 'build', '🧱', 3], ['store', '农牧渔获', 'farm', '🌾', 4],
            ['store', '服务与代工', 'service', '🛠', 5],
            ['product', '方块与建材', 'blocks', '', 1], ['product', '工具与装备', 'tools', '', 2],
            ['product', '食物与作物', 'food', '', 3], ['product', '矿物与材料', 'materials', '', 4],
            ['product', '怪物掉落', 'drops', '', 5], ['product', '附魔与药水', 'enchants', '', 6],
            ['product', '地图画与装饰', 'art', '', 7], ['product', '服务与代工', 'service', '', 8],
            ['product', '其他', 'other', '', 99]
        ];
        for (const [kind, name, slug, icon, sort] of seeds) {
            await db.run('INSERT OR IGNORE INTO market_categories (kind, name, slug, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
                [kind, name, slug, icon, sort]);
        }
        console.log(`✓ 写入默认分类 ${seeds.length} 条`);
    } else {
        console.log(`· 分类已有 ${catCount.c} 条，跳过种子`);
    }

    // 汇总
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'market_%' ORDER BY name`);
    console.log(`\n集市表共 ${tables.length} 张：${tables.map(t => t.name).join(', ')}`);
    console.log('迁移完成 ✓');
    process.exit(0);
})().catch(e => {
    console.error('迁移失败：', e.message);
    process.exit(1);
});
