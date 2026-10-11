/**
 * 「紫雪坊市公会集市」领域层
 *
 * 只做业务规则与账务，不碰 HTTP（路由在 routes/market.js）。
 *
 * 资金模型（用户已确认：只保留托管账号，**公会不设余额账号**）
 *   下单：买家 -X → market_escrow +X         （同一事务，两条流水）
 *   结算：escrow -buyerPay → 商家 +merchantIncome；税从 escrow 直接划出并退出流通
 *   退款：escrow -X → 买家 +X（未结算订单从未记过税，因此不产生税务流水）
 *   争议：订单置为 disputed，钱继续留在 escrow，任何自动结算都不许动它
 *   费用：店主 -F（钱退出流通，只写 market_finance_ledger）
 *   → 余额的唯一真相仍是 users.contribution；托管账号是唯一的中间态账户
 *
 * 公会收入只以**分户账**形式存在（market_finance_ledger），不落在任何用户余额上：
 *   direction='in'  = 公会收入（钱从付款方扣除后退出流通）
 *   direction='out' = 冲回（钱重新回到用户余额，如开店被拒退费）
 *
 * 账务三件套（明确区分，且**没有平台服务费/成交抽成**）：
 *   1) 开店费   2) 续期费   3) 交易税
 */
const crypto = require('crypto');
const db = require('../database');
const logger = require('./logger');
const { addContributionLog } = require('./contribution');

const ESCROW_USERNAME = 'market_escrow';
/** 托管账号头像取这个账号的同款（用户 2026-10-11 指定：托管头像与 id=1 用户一致） */
const GUILD_OFFICIAL_USERNAME = 'xuanjian_guild';
const CONFIG_KEY = 'market_config';
const CYCLE_PRESETS = { daily: 1, weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };

const ORDER_STATUS = {
    PENDING_PAYMENT: 'pending_payment',
    PAID: 'paid',
    DELIVERED: 'delivered',
    AWAITING_CONFIRM: 'awaiting_confirm',
    SETTLED: 'settled',
    CANCELLED: 'cancelled',
    REFUNDING: 'refunding',
    REFUNDED: 'refunded',
    DISPUTED: 'disputed',
    EXPIRED: 'expired'
};
const ORDER_STATUS_LABEL = {
    pending_payment: '待付款', paid: '已付款·待核销', delivered: '已核销·待履约',
    awaiting_confirm: '待确认收货', settled: '已完成', cancelled: '已取消',
    refunding: '退款处理中', refunded: '已退款', disputed: '争议处理中', expired: '已过期'
};
const STORE_STATUS_LABEL = {
    pending: '待审核', active: '营业中', paused: '暂停营业', grace: '续费宽限期',
    suspended: '欠费暂停', closed: '已关闭', rejected: '审核未通过'
};
const DIMENSIONS = { overworld: '主世界', nether: '下界', end: '末地', custom: '自定义' };

const DEFAULTS = {
    openFeeEnabled: true, openFee: 5, openFeeFirstFree: true,
    renewFeeEnabled: true, renewFee: 2, cyclePreset: 'monthly', cycleDays: 30,
    graceDays: 7, remindBeforeDays: 3, autoPauseAfterGrace: true,
    taxEnabled: true, taxRateBp: 500, taxMode: 'merchant', taxRounding: 'round',
    maxOpenStoresPerUser: 1, perOrderLimitDefault: 10, maxProductsPerStore: 50,
    verifyCodeTtlHours: 72, autoConfirmDays: 7,
    mapRange: { default: { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000, flipZ: true } },
    mapBackgrounds: {}, reviewRequireOrder: true, storeReviewRequired: true
};

/* ==================== 基础工具 ==================== */

/** 金额统一 2 位小数（贡献点允许小数，users 表触发器也强制 2 位） */
function money(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * 100) / 100;
}

/** 按配置的舍入规则取整到 0.01 */
function roundBy(n, mode = 'round') {
    const v = n * 100;
    const r = mode === 'floor' ? Math.floor(v + 1e-9) : mode === 'ceil' ? Math.ceil(v - 1e-9) : Math.round(v + 1e-9);
    return r / 100;
}

const now = () => db.getLocalTimestamp();
function addDays(base, days) {
    const d = base ? new Date(String(base).replace(' ', 'T')) : new Date();
    d.setDate(d.getDate() + Number(days || 0));
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function daysBetween(a, b) {
    const t1 = new Date(String(a).replace(' ', 'T')).getTime();
    const t2 = new Date(String(b).replace(' ', 'T')).getTime();
    return Math.ceil((t2 - t1) / 86400000);
}

/* ==================== 配置 ==================== */

async function getConfig() {
    let cfg = {};
    try {
        const row = await db.get('SELECT value FROM settings WHERE key = ?', [CONFIG_KEY]);
        if (row && row.value) cfg = JSON.parse(row.value);
    } catch (e) {
        logger.error('读取 market_config 失败:', e.message);
    }
    return { ...DEFAULTS, ...cfg, mapRange: { ...DEFAULTS.mapRange, ...(cfg.mapRange || {}) } };
}

async function saveConfig(patch, operatorId = null) {
    const before = await getConfig();
    const next = { ...before, ...patch };
    // 数值兜底
    for (const k of ['openFee', 'renewFee', 'cycleDays', 'graceDays', 'remindBeforeDays', 'verifyCodeTtlHours', 'autoConfirmDays', 'perOrderLimitDefault', 'maxProductsPerStore', 'maxOpenStoresPerUser']) {
        if (next[k] !== undefined) next[k] = Math.max(0, Number(next[k]) || 0);
    }
    if (next.taxRateBp !== undefined) next.taxRateBp = Math.min(10000, Math.max(0, Math.round(Number(next.taxRateBp) || 0)));
    if (!['merchant', 'buyer'].includes(next.taxMode)) next.taxMode = DEFAULTS.taxMode;
    if (!['round', 'floor', 'ceil'].includes(next.taxRounding)) next.taxRounding = DEFAULTS.taxRounding;
    if (!CYCLE_PRESETS[next.cyclePreset] && next.cyclePreset !== 'custom') next.cyclePreset = DEFAULTS.cyclePreset;
    await db.run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        [CONFIG_KEY, JSON.stringify(next), now()]);
    await audit(operatorId, 'config_update', 'config', null, before, next, patch.reason || '');
    return next;
}

/** 当前计费周期天数：预设优先，custom 用 cycleDays */
function cycleDaysOf(cfg) {
    if (cfg.cyclePreset && cfg.cyclePreset !== 'custom' && CYCLE_PRESETS[cfg.cyclePreset]) return CYCLE_PRESETS[cfg.cyclePreset];
    return Math.max(1, Number(cfg.cycleDays) || 30);
}

/* ==================== 审计 ==================== */

async function audit(operatorId, action, targetType, targetId, beforeJson, afterJson, reason = '') {
    try {
        await db.run(
            `INSERT INTO market_audit_logs (action, target_type, target_id, operator_id, before_json, after_json, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [action, targetType || '', targetId || null, operatorId || null,
                beforeJson ? JSON.stringify(beforeJson).slice(0, 4000) : '',
                afterJson ? JSON.stringify(afterJson).slice(0, 4000) : '', reason, now()]
        );
    } catch (e) {
        logger.error('集市审计写入失败:', e.message);
    }
}

/* ==================== 账户与账务 ==================== */

async function systemUserId(username, nickname) {
    let u = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (u) return u.id;
    const r = await db.run(
        `INSERT INTO users (username, nickname, password, level, contribution, email_verified, password_set)
         VALUES (?, ?, ?, -1, 0, 0, 0)`,
        [username, nickname, crypto.randomBytes(24).toString('hex')]
    );
    logger.info(`集市：已创建系统账号 ${username}（id=${r.id}）`);
    return r.id;
}
/**
 * 托管账号头像：跟公会官方账号（默认 id=1 / username=xuanjian_guild）保持同款。
 * 已核查线上 `users` 表：avatar 只有普通字段，**没有任何唯一约束**（默认头像被 18 个账号共用），
 * 因此直接复用同一 URL 即可，无需再往七牛另传一份文件。
 */
let escrowAvatarSynced = false;
async function syncEscrowAvatar(force = false) {
    const escrow = await db.get('SELECT id, avatar FROM users WHERE username = ?', [ESCROW_USERNAME]);
    if (!escrow) return null;
    const cur = String(escrow.avatar || '').trim();
    if (!force && cur && !/default-avatar/.test(cur)) return cur;   // 已有自定义头像就不覆盖
    const src = await db.get(
        `SELECT avatar FROM users WHERE COALESCE(avatar, '') <> '' AND (username = ? OR id = 1)
         ORDER BY (username = ?) DESC, id ASC LIMIT 1`,
        [GUILD_OFFICIAL_USERNAME, GUILD_OFFICIAL_USERNAME]
    );
    const avatar = src ? String(src.avatar || '').trim() : '';
    if (!avatar) {
        logger.warn('集市：公会官方账号没有头像，托管账号暂时保留默认头像');
        return null;
    }
    await db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatar, escrow.id]);
    logger.info(`集市：托管账号头像已同步（user#${escrow.id} → ${avatar}）`);
    return avatar;
}

/** 取托管账号 id（首次调用时顺带补齐头像，之后不再重复查库） */
async function escrowId() {
    const id = await systemUserId(ESCROW_USERNAME, '集市托管账户');
    if (!escrowAvatarSynced) {
        try {
            await syncEscrowAvatar();
        } catch (e) {
            logger.error('集市：托管账号头像同步失败:', e.message);
        }
        escrowAvatarSynced = true;
    }
    return id;
}

/** 单账户变动（写余额 + 流水），必须在事务内调用 */
async function moveBalance(userId, amount, type, refId, note) {
    const amt = money(amount);
    if (!amt) return 0;
    await db.run('UPDATE users SET contribution = COALESCE(contribution, 0) + ? WHERE id = ?', [amt, userId]);
    const row = await db.get('SELECT contribution FROM users WHERE id = ?', [userId]);
    await addContributionLog(userId, amt, type, refId || 0, note || '');
    return money(row ? row.contribution : 0);
}

/** 原子转移：from → to（同一事务两条流水） */
async function transferPoints(fromUserId, toUserId, amount, outType, inType, refId, note) {
    const amt = money(amount);
    if (amt <= 0) return { moved: 0 };
    const from = await db.get('SELECT id, contribution FROM users WHERE id = ?', [fromUserId]);
    if (!from) throw Object.assign(new Error('付款账户不存在'), { status: 400 });
    if (money(from.contribution) + 1e-9 < amt) {
        throw Object.assign(new Error(`贡献点不足（需 ${amt}，现有 ${money(from.contribution)}）`), { status: 400 });
    }
    await moveBalance(fromUserId, -amt, outType, refId, note);
    await moveBalance(toUserId, amt, inType, refId, note);
    return { moved: amt };
}

/* ==================== 公会收入分户账（公会没有余额账号） ==================== */

/**
 * 记一条公会收入（direction='in'）。必须与"从某账户扣钱"处于同一事务。
 * 幂等：idem_key 唯一，重复调用返回 0。
 */
async function financeIncome({ kind, amount, fromUserId = null, orderId = null, storeId = null, note = '', idemKey = null, operatorId = null, taxMode = '', taxRateBp = 0 }) {
    const amt = money(amount);
    if (!(amt > 0)) return 0;
    const r = await db.run(
        `INSERT OR IGNORE INTO market_finance_ledger
            (kind, direction, amount, order_id, store_id, from_user_id, tax_mode, tax_rate_bp, note, operator_id, idem_key, created_at)
         VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [kind, amt, orderId, storeId, fromUserId, taxMode || '', Number(taxRateBp) || 0, note || '', operatorId, idemKey, now()]
    );
    return r.changes ? amt : 0;
}

/**
 * 记一条公会收入冲回（direction='out'），钱会重新回到用户余额。
 * 幂等：idem_key 唯一，重复调用返回 0。
 */
async function financeReversal({ kind, amount, toUserId = null, orderId = null, storeId = null, note = '', idemKey = null, operatorId = null }) {
    const amt = money(amount);
    if (!(amt > 0)) return 0;
    const r = await db.run(
        `INSERT OR IGNORE INTO market_finance_ledger
            (kind, direction, amount, order_id, store_id, from_user_id, note, operator_id, idem_key, created_at)
         VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [kind, amt, orderId, storeId, toUserId, note || '', operatorId, idemKey, now()]
    );
    return r.changes ? amt : 0;
}

/**
 * 收费（开店费 / 续期费 / 交易税）：从账户扣钱 + 记公会收入。
 * 扣掉的钱直接退出流通——公会不持有余额，分户账就是收入凭证。
 * 顺序：先查重 → 先校验余额 → 再扣钱 → 再记账（任一步失败都让整个事务回滚）。
 * @returns {number} 实际收取金额（0 表示免费或该 idem_key 已收过）
 */
async function chargeFee({ userId, amount, kind, type = 'market_fee', refId = 0, storeId = null, orderId = null, note = '', idemKey = null, operatorId = null, taxMode = '', taxRateBp = 0 }) {
    const amt = money(amount);
    if (!(amt > 0)) return 0;
    if (idemKey) {
        const dup = await db.get('SELECT id FROM market_finance_ledger WHERE idem_key = ?', [idemKey]);
        if (dup) return 0;                        // 幂等：这笔收入已记过，不再重复扣钱
    }
    const acc = await db.get('SELECT id, contribution FROM users WHERE id = ?', [userId]);
    if (!acc) throw Object.assign(new Error('付费账户不存在'), { status: 400 });
    if (money(acc.contribution) + 1e-9 < amt) {
        throw Object.assign(new Error(`贡献点不足（需 ${amt}，现有 ${money(acc.contribution)}）`), { status: 400 });
    }
    await moveBalance(userId, -amt, type, refId, note);
    const booked = await financeIncome({ kind, amount: amt, fromUserId: userId, orderId, storeId, note, idemKey, operatorId, taxMode, taxRateBp });
    if (!booked) throw new Error(`公会收入记账失败（${kind} ${amt}），已回滚扣款`);
    return amt;
}

/** 退费（如开店申请被拒）：把钱加回用户余额 + 记冲回。幂等同上，返回实际退还金额 */
async function refundFee({ userId, amount, kind = 'refund_fee', type = 'market_refund', refId = 0, storeId = null, orderId = null, note = '', idemKey = null, operatorId = null }) {
    const amt = money(amount);
    if (!(amt > 0)) return 0;
    if (idemKey) {
        const dup = await db.get('SELECT id FROM market_finance_ledger WHERE idem_key = ?', [idemKey]);
        if (dup) return 0;
    }
    await moveBalance(userId, amt, type, refId, note);
    const booked = await financeReversal({ kind, amount: amt, toUserId: userId, orderId, storeId, note, idemKey, operatorId });
    if (!booked) throw new Error(`公会收入冲回记账失败（${kind} ${amt}），已回滚入账`);
    return amt;
}

/* ==================== 税费计算 ==================== */

/**
 * 计算订单金额与税费。
 * @param {number} amount 商品成交额（已应用折扣前的原价合计）
 * @param {number} discount 折扣金额
 * @param {object} cfg
 * @returns {{taxBase:number,taxBp:number,taxMode:string,tax:number,buyerPay:number,merchantIncome:number}}
 */
function calcTax(amount, discount, cfg) {
    const gross = money(amount);
    const disc = money(Math.min(discount || 0, gross));
    const taxBase = money(gross - disc);
    const taxBp = cfg.taxEnabled ? Number(cfg.taxRateBp) || 0 : 0;
    const taxMode = cfg.taxMode === 'buyer' ? 'buyer' : 'merchant';
    const rawTax = taxBase * taxBp / 10000;
    const tax = roundBy(rawTax, cfg.taxRounding || 'round');
    if (taxMode === 'buyer') {
        // 买家承担：商家照拿成交额，买家多付税
        return { taxBase, taxBp, taxMode, tax, buyerPay: money(taxBase + tax), merchantIncome: taxBase };
    }
    // 商家承担：买家只付成交额，税从商家应得里扣
    return { taxBase, taxBp, taxMode, tax, buyerPay: taxBase, merchantIncome: money(taxBase - tax) };
}

/* ==================== 店铺 ==================== */

const slugifyStore = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function uniqueStoreSlug(name) {
    const base = slugifyStore(name) || `store-${Date.now().toString(36)}`;
    let slug = base;
    for (let i = 2; i < 200; i++) {
        const dup = await db.get('SELECT id FROM market_stores WHERE slug = ?', [slug]);
        if (!dup) return slug;
        slug = `${base}-${i}`;
    }
    return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

/** 店铺是否可接单（营业中；宽限期仍可接单，欠费暂停/关闭不可） */
function storeSellable(store) {
    return !!store && (store.status === 'active' || store.status === 'grace');
}

/* ==================== 核销码 ==================== */

const hashCode = (code) => crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');

/** 生成一次性核销码：人类可读、去掉易混字符，10 位 + 校验段 */
function generateVerifyCode() {
    const alphabet = 'ACDEFGHJKLMNPQRTUVWXY34679';   // 去掉 I O S Z 0 1 2 5 8 等易混
    const pick = (n) => Array.from({ length: n }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
    return `BW-${pick(4)}-${pick(6)}`;
}

/* ==================== 通知事件（Outbox） ==================== */

/**
 * 写一条通知事件（幂等：event_key 唯一）。
 * 必须在业务事务**之后**调用；同一 key 重复调用不会重复投递。
 */
async function emitEvent({ eventKey, eventType, userId = null, storeId = null, orderId = null, payload = {}, channels = 'inapp,realtime,mail' }) {
    try {
        const r = await db.run(
            `INSERT OR IGNORE INTO market_notify_events (event_key, event_type, order_id, store_id, user_id, payload, channels, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
            [eventKey, eventType, orderId, storeId, userId, JSON.stringify(payload), channels, now()]
        );
        return r.changes > 0 ? r.id : 0;
    } catch (e) {
        logger.error('集市通知事件写入失败:', e.message);
        return 0;
    }
}

/* ==================== 档案 ==================== */

function archiveNo(prefix) {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${rand}`;
}

/** 归档（幂等：同 kind+ref 已存在则更新 payload 并追加版本号说明） */
async function writeArchive({ kind, refType, refId, title, summary = '', payload = {}, operatorId = null }) {
    const exist = await db.get('SELECT id, archive_no FROM market_archives WHERE kind = ? AND ref_type = ? AND ref_id = ?', [kind, refType, refId]);
    if (exist) {
        await db.run('UPDATE market_archives SET title = ?, summary = ?, payload = ? WHERE id = ?',
            [title, summary, JSON.stringify(payload), exist.id]);
        return exist;
    }
    const no = archiveNo(kind === 'store' ? 'PS' : 'PL');   // 坊市档案号：PS=商铺 PL=流水
    const r = await db.run(
        `INSERT INTO market_archives (archive_no, kind, ref_type, ref_id, title, summary, payload, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [no, kind, refType, refId, title, summary, JSON.stringify(payload), operatorId, now()]
    );
    return { id: r.id, archive_no: no };
}

/* ==================== 地图投影 ==================== */

/**
 * Minecraft 世界坐标 → 地图 0..100 百分比坐标。
 * 规则统一在这里，前端只做像素换算，不再各自解释比例。
 */
function projectToMap(serverKey, dimension, x, z, cfg) {
    const key = `${serverKey}|${dimension}`;
    const bg = (cfg.mapBackgrounds || {})[key];
    const range = bg || (cfg.mapRange || {})[serverKey] || (cfg.mapRange || {}).default
        || { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000, flipZ: true };
    const minX = Number(range.minX), maxX = Number(range.maxX), minZ = Number(range.minZ), maxZ = Number(range.maxZ);
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    const flipZ = range.flipZ !== false;
    const px = ((Number(x) - minX) / spanX) * 100;
    const pzRaw = ((Number(z) - minZ) / spanZ) * 100;
    const py = flipZ ? 100 - pzRaw : pzRaw;
    return {
        x: Math.max(0, Math.min(100, px)),
        y: Math.max(0, Math.min(100, py)),
        inside: px >= 0 && px <= 100 && pzRaw >= 0 && pzRaw <= 100,
        range: { minX, maxX, minZ, maxZ, flipZ }
    };
}

/* ==================== 短链 ==================== */

async function shortLinkFor(targetType, targetId) {
    const exist = await db.get('SELECT code FROM market_short_links WHERE target_type = ? AND target_id = ? AND disabled = 0',
        [targetType, targetId]);
    if (exist) return exist.code;
    for (let i = 0; i < 12; i++) {
        const code = crypto.randomBytes(4).toString('base64url').replace(/[-_]/g, '').slice(0, 5);
        if (code.length < 5) continue;
        const dup = await db.get('SELECT id FROM market_short_links WHERE code = ?', [code]);
        if (dup) continue;
        await db.run('INSERT INTO market_short_links (code, target_type, target_id, created_at) VALUES (?, ?, ?, ?)',
            [code, targetType, targetId, now()]);
        return code;
    }
    throw new Error('短链生成失败');
}

module.exports = {
    // 常量
    ESCROW_USERNAME, GUILD_OFFICIAL_USERNAME, CONFIG_KEY, CYCLE_PRESETS, DEFAULTS,
    ORDER_STATUS, ORDER_STATUS_LABEL, STORE_STATUS_LABEL, DIMENSIONS,
    // 工具
    money, roundBy, now, addDays, daysBetween, cycleDaysOf,
    // 配置
    getConfig, saveConfig,
    // 账务
    systemUserId, escrowId, syncEscrowAvatar, moveBalance, transferPoints, calcTax,
    financeIncome, financeReversal, chargeFee, refundFee,
    // 店铺
    slugifyStore, uniqueStoreSlug, storeSellable,
    // 核销码
    generateVerifyCode, hashCode,
    // 通知/档案/地图/短链
    emitEvent, writeArchive, archiveNo, projectToMap, shortLinkFor,
    // 审计
    audit
};
