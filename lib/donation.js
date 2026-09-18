/**
 * 捐赠墙 / 公账核心逻辑
 *
 * 数据模型 donation_ledger：
 *   direction='in'  入账（捐赠）：user_id=捐赠者，amount=金额(元)，ratio=比例(点/元)，points=实发贡献点
 *   direction='out' 支出：purpose=用处，amount=金额(元)
 *
 * 贡献点：入账时按「金额 × 每笔单独填写的比例」发放（保留 2 位小数），
 *         写 contribution_logs(type='donation')；编辑/删除时按差额回滚，保证账实一致。
 */
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { addContributionLog } = require('./contribution');
const logger = require('./logger');

const QR_SETTING_KEY = 'donation_qr_url';
const MATERIAL_ADMIN_ONLY = 0; // is_public: 0=仅管理员 1=公开

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** 公账汇总：收入 / 支出 / 余额 */
async function summary() {
    const s = await db.get(`SELECT
        COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END),0) AS income,
        COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS expense,
        COUNT(CASE WHEN direction='in'  THEN 1 END) AS in_count,
        COUNT(CASE WHEN direction='out' THEN 1 END) AS out_count,
        COALESCE(SUM(CASE WHEN direction='in' THEN points ELSE 0 END),0) AS points_total
        FROM donation_ledger`);
    return {
        income: r2(s.income),
        expense: r2(s.expense),
        balance: r2(s.income - s.expense),
        inCount: s.in_count || 0,
        outCount: s.out_count || 0,
        pointsTotal: r2(s.points_total),
    };
}

/** 付款码 URL（存 settings 表） */
async function getQrUrl() {
    const row = await db.get('SELECT value FROM settings WHERE key=?', [QR_SETTING_KEY]);
    return row ? row.value : '';
}

async function setQrUrl(url) {
    await db.run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?,?,?)',
        [QR_SETTING_KEY, url || '', getLocalTimestamp()]);
}

/** 解析材料 JSON（容错） */
function parseMaterials(raw) {
    if (!raw) return [];
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
}

/**
 * 出入账明细（分页）
 * @param {{page?:number, limit?:number, direction?:'in'|'out'|'', includePrivate?:boolean}} opts
 *        includePrivate=false 时，仅管理员可见的材料会被打码（前端仍能看到条目，只是拿不到材料）
 */
async function listLedger({ page = 1, limit = 30, direction = '', includePrivate = false } = {}) {
    const lim = Math.min(Math.max(parseInt(limit) || 30, 1), 200);
    const off = (Math.max(parseInt(page) || 1, 1) - 1) * lim;
    const where = [];
    const params = [];
    if (direction === 'in' || direction === 'out') { where.push('d.direction = ?'); params.push(direction); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = await db.all(
        `SELECT d.*, u.username, u.nickname, u.avatar,
                cu.username AS creator_username, cu.nickname AS creator_nickname
         FROM donation_ledger d
         LEFT JOIN users u  ON u.id  = d.user_id
         LEFT JOIN users cu ON cu.id = d.created_by
         ${w}
         ORDER BY d.occurred_on DESC, d.id DESC
         LIMIT ? OFFSET ?`,
        [...params, lim, off]
    );
    const total = await db.get(`SELECT COUNT(*) AS c FROM donation_ledger d ${w}`, params);

    const list = rows.map(r => {
        const mats = parseMaterials(r.materials);
        return {
            id: r.id,
            direction: r.direction,
            amount: r2(r.amount),
            ratio: r2(r.ratio),
            points: r2(r.points),
            purpose: r.purpose || '',
            note: r.note || '',
            occurredOn: r.occurred_on,
            // 匿名捐赠：对外不暴露捐赠者身份，但金额照常公开
            anonymous: r.direction === 'in' ? !r.is_public : false,
            donor: r.direction === 'in'
                ? (r.is_public
                    ? { id: r.user_id, username: r.username || '', nickname: r.nickname || '成员', avatar: r.avatar || '' }
                    : { id: r.user_id, username: '', nickname: '匿名捐赠者', avatar: '' })
                : null,
            // 材料：默认仅管理员可见；includePrivate=false 时不下发未公开材料
            materials: mats.filter(m => includePrivate || m.public).map(m => ({
                url: m.url, name: m.name, size: m.size, type: m.type, public: !!m.public,
            })),
            hiddenMaterialCount: includePrivate ? 0 : mats.filter(m => !m.public).length,
            createdBy: r.created_by,
            creatorName: r.creator_nickname || r.creator_username || '',
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    });

    return { list, total: total.c || 0, page: Math.max(parseInt(page) || 1, 1), limit: lim };
}

/**
 * 捐赠者卡片（按累计捐赠额倒序，分页）
 * 仅统计 direction='in' 且金额>0 的记录
 */
async function listDonors({ page = 1, limit = 12 } = {}) {
    const lim = Math.min(Math.max(parseInt(limit) || 12, 1), 60);
    const off = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

    const total = await db.get(
        `SELECT COUNT(*) AS c FROM (
            SELECT user_id FROM donation_ledger
            WHERE direction='in' AND user_id IS NOT NULL AND amount > 0
            GROUP BY user_id
        )`
    );

    const rows = await db.all(
        `SELECT d.user_id,
                SUM(d.amount) AS total_amount,
                SUM(d.points) AS total_points,
                COUNT(*)      AS times,
                MAX(d.occurred_on) AS last_on,
                MAX(d.is_public)   AS any_public,
                u.username, u.nickname, u.avatar, u.skin_path, u.game_id
         FROM donation_ledger d
         JOIN users u ON u.id = d.user_id
         WHERE d.direction='in' AND d.user_id IS NOT NULL AND amount > 0
         GROUP BY d.user_id
         ORDER BY total_amount DESC, d.user_id ASC
         LIMIT ? OFFSET ?`,
        [lim, off]
    );

    // 整位捐赠者若所有记录都选了匿名，则对外匿名
    const list = rows.map(r => {
        const anon = !r.any_public;
        return {
            userId: r.user_id,
            anonymous: anon,
            nickname: anon ? '匿名捐赠者' : (r.nickname || r.username || '成员'),
            username: anon ? '' : (r.username || ''),
            avatar: anon ? '' : (r.avatar || ''),
            skin: anon ? null : (r.skin_path || null),
            gameId: anon ? null : (r.game_id || ''),
            totalAmount: r2(r.total_amount),
            totalPoints: r2(r.total_points),
            times: r.times,
            lastOn: r.last_on,
        };
    });

    return { list, total: total.c || 0, page: Math.max(parseInt(page) || 1, 1), limit: lim };
}

/** 取单条 */
async function getEntry(id) {
    const r = await db.get('SELECT * FROM donation_ledger WHERE id=?', [id]);
    if (!r) return null;
    return { ...r, materials: parseMaterials(r.materials) };
}

/** 按「金额 × 比例」计算实发贡献点（保留 2 位小数） */
function calcPoints(amount, ratio) {
    return r2((Number(amount) || 0) * (Number(ratio) || 0));
}

/**
 * 新增一条账目
 * @param {{direction:'in'|'out', userId?:number, amount:number, ratio?:number,
 *          purpose?:string, note?:string, occurredOn?:string, isPublic?:boolean,
 *          materials?:Array, materialsJson?:string}} data
 */
async function createEntry(data, adminId) {
    const direction = data.direction === 'out' ? 'out' : 'in';
    const amount = r2(data.amount);
    if (!(amount > 0)) return { error: '金额必须大于 0' };

    const occurredOn = String(data.occurredOn || '').slice(0, 10) || getLocalTimestamp().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return { error: '日期格式应为 YYYY-MM-DD' };

    let userId = null, ratio = 0, points = 0;
    if (direction === 'in') {
        userId = data.userId ? parseInt(data.userId) : null;
        if (!userId) return { error: '请选择捐赠成员' };
        const u = await db.get('SELECT id FROM users WHERE id=?', [userId]);
        if (!u) return { error: '成员不存在' };
        ratio = r2(data.ratio);
        if (ratio < 0) return { error: '比例不能为负' };
        points = calcPoints(amount, ratio);
    }

    const materialsJson = data.materialsJson || JSON.stringify(data.materials || []);
    const isPublic = direction === 'in' ? (data.isPublic === false ? 0 : 1) : 1;

    const ins = await db.run(
        `INSERT INTO donation_ledger
           (direction, user_id, amount, ratio, points, purpose, note, occurred_on, is_public, materials, created_by, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [direction, userId, amount, ratio, points,
            direction === 'out' ? String(data.purpose || '').slice(0, 120) : null,
            String(data.note || '').slice(0, 500),
            occurredOn, isPublic, materialsJson, adminId || null, getLocalTimestamp()]
    );

    // 发放贡献点
    if (direction === 'in' && points > 0) {
        await db.run('UPDATE users SET contribution = COALESCE(contribution,0) + ?, updated_at=? WHERE id=?',
            [points, getLocalTimestamp(), userId]);
        await addContributionLog(userId, points, 'donation', ins.id,
            `捐赠奖励（${amount} 元 × ${ratio}）${data.note ? '：' + String(data.note).slice(0, 60) : ''}`);
    }

    logger.info(`捐赠账目新增: id=${ins.id} ${direction} amount=${amount} user=${userId || '-'} points=${points} by=${adminId}`);
    return { id: ins.id, points, direction, amount };
}

/**
 * 编辑账目（含贡献点差额回滚）
 */
async function updateEntry(id, data, adminId) {
    const old = await getEntry(id);
    if (!old) return { error: '账目不存在' };
    if (old.direction !== (data.direction === 'out' ? 'out' : 'in')) {
        return { error: '不支持修改收支方向，请删除后重建' };
    }

    const amount = r2(data.amount);
    if (!(amount > 0)) return { error: '金额必须大于 0' };
    const occurredOn = String(data.occurredOn || old.occurred_on).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return { error: '日期格式应为 YYYY-MM-DD' };

    const isIn = old.direction === 'in';
    let userId = old.user_id, ratio = r2(old.ratio), points = r2(old.points);

    if (isIn) {
        if (data.userId) {
            const nid = parseInt(data.userId);
            const u = await db.get('SELECT id FROM users WHERE id=?', [nid]);
            if (!u) return { error: '成员不存在' };
            userId = nid;
        }
        if (data.ratio !== undefined) ratio = r2(data.ratio);
        points = calcPoints(amount, ratio);
    }

    const materialsJson = data.materialsJson !== undefined
        ? data.materialsJson
        : JSON.stringify(old.materials);

    await db.run(
        `UPDATE donation_ledger
         SET user_id=?, amount=?, ratio=?, points=?, purpose=?, note=?, occurred_on=?, is_public=?, materials=?, updated_at=?
         WHERE id=?`,
        [userId, amount, ratio, points,
            isIn ? old.purpose : String(data.purpose || '').slice(0, 120),
            String(data.note ?? old.note ?? '').slice(0, 500),
            occurredOn,
            isIn ? (data.isPublic === false ? 0 : 1) : 1,
            materialsJson, getLocalTimestamp(), id]
    );

    // 贡献点差额回滚：换人则先全额扣旧、再全额加新
    if (isIn) {
        const oldUser = old.user_id;
        const oldPoints = r2(old.points);
        if (oldUser !== userId) {
            if (oldPoints > 0 && oldUser) {
                await db.run('UPDATE users SET contribution = COALESCE(contribution,0) - ? WHERE id=?', [oldPoints, oldUser]);
                await addContributionLog(oldUser, -oldPoints, 'donation', id,
                    `捐赠奖励调整（改绑成员，扣回原发放 ${oldPoints}）`);
            }
            if (points > 0 && userId) {
                await db.run('UPDATE users SET contribution = COALESCE(contribution,0) + ? WHERE id=?', [points, userId]);
                await addContributionLog(userId, points, 'donation', id, `捐赠奖励（改绑成员，${amount} 元 × ${ratio}）`);
            }
        } else if (points !== oldPoints && userId) {
            const delta = r2(points - oldPoints);
            await db.run('UPDATE users SET contribution = COALESCE(contribution,0) + ? WHERE id=?', [delta, userId]);
            await addContributionLog(userId, delta, 'donation', id,
                `捐赠奖励调整（${oldPoints} → ${points}，${amount} 元 × ${ratio}）`);
        }
    }

    logger.info(`捐赠账目修改: id=${id} amount=${amount} points=${points} by=${adminId}`);
    return { id, points, direction: old.direction, amount };
}

/** 删除账目（回滚贡献点 + 回收材料文件） */
async function deleteEntry(id, adminId) {
    const old = await getEntry(id);
    if (!old) return { error: '账目不存在' };

    if (old.direction === 'in' && old.user_id && r2(old.points) > 0) {
        const pts = r2(old.points);
        await db.run('UPDATE users SET contribution = COALESCE(contribution,0) - ? WHERE id=?', [pts, old.user_id]);
        await addContributionLog(old.user_id, -pts, 'donation', id, `捐赠奖励撤销（删除账目 #${id}，扣回 ${pts}）`);
    }
    await db.run('DELETE FROM donation_ledger WHERE id=?', [id]);

    // 回收对象存储中的材料（失败不影响主流程）
    try {
        const chatUpload = require('./chat-upload');
        const urls = old.materials.map(m => m.url).filter(Boolean);
        if (urls.length) await chatUpload.deleteByUrls(urls);
    } catch (e) {
        logger.warn('捐赠材料回收失败:', e.message);
    }

    logger.info(`捐赠账目删除: id=${id} by=${adminId}`);
    return { id };
}

module.exports = {
    summary, getQrUrl, setQrUrl, listLedger, listDonors, getEntry,
    createEntry, updateEntry, deleteEntry, calcPoints, parseMaterials, r2,
};
