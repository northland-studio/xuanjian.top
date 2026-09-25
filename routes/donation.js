/**
 * 捐赠墙 / 公账 接口
 *  公开（无需登录）：
 *    GET  /api/donation/summary        公账汇总（收入/支出/余额）+ 收款码
 *    GET  /api/donation/ledger         出入账明细（分页，可筛方向）
 *    GET  /api/donation/donors         捐赠者卡片（按累计金额倒序，分页）
 *  管理端（level>=1）：
 *    GET  /api/donation/admin/search-users      搜索成员（选捐赠人）
 *    POST /api/donation/admin/entry             新增账目（入账按比例发贡献点）
 *    PUT  /api/donation/admin/entry/:id         编辑账目（含贡献点差额回滚）
 *    DELETE /api/donation/admin/entry/:id       删除账目（回滚贡献点 + 回收材料）
 *    POST /api/donation/admin/materials         上传材料（图片/PDF）
 *    POST /api/donation/admin/qr                上传/替换收款码
 *    GET  /api/donation/export/xlsx             导出 Excel
 */
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../database');
const { authMiddleware, adminMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const logger = require('../lib/logger');
const donation = require('../lib/donation');
const donationUpload = require('../lib/donation-upload');

const router = express.Router();

// 材料：图片 ≤5MB / PDF ≤20MB（用 multer 的内存存储，limits 取最大值 20MB，
// 图片的 5MB 限制在业务层单独判断，便于给出精确提示）
const uploadMem = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

/** 判断请求者是否为管理员（用于下发未公开材料） */
async function isAdminReq(req) {
    if (!req.userId) return false;
    const u = await db.get('SELECT level FROM users WHERE id=?', [req.userId]);
    return !!u && (u.level || 0) >= 1;
}

// ============ 公开 ============

// 公账汇总 + 收款码
router.get('/summary', async (req, res) => {
    try {
        const [s, qr] = await Promise.all([donation.summary(), donation.getQrUrl()]);
        res.json({ summary: s, qrUrl: qr });
    } catch (e) {
        logger.error('获取公账汇总失败:', e.message);
        res.status(500).json({ error: '获取失败' });
    }
});

// 出入账明细
router.get('/ledger', optionalAuthMiddleware, async (req, res) => {
    try {
        const includePrivate = await isAdminReq(req);
        const r = await donation.listLedger({
            page: req.query.page,
            limit: req.query.limit,
            direction: req.query.direction,
            includePrivate,
        });
        res.json({ ...r, isAdmin: includePrivate });
    } catch (e) {
        logger.error('获取出入账明细失败:', e.message);
        res.status(500).json({ error: '获取失败' });
    }
});

// 捐赠者卡片
router.get('/donors', async (req, res) => {
    try {
        const r = await donation.listDonors({ page: req.query.page, limit: req.query.limit });
        res.json(r);
    } catch (e) {
        logger.error('获取捐赠者列表失败:', e.message);
        res.status(500).json({ error: '获取失败' });
    }
});

// ============ 管理端 ============

// 搜索成员（选捐赠人用）
router.get('/admin/search-users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q) return res.json({ users: [] });
        const like = `%${q}%`;
        const rows = await db.all(
            `SELECT id, username, nickname, avatar, contribution FROM users
             WHERE username LIKE ? OR nickname LIKE ? OR CAST(id AS TEXT) = ? OR game_id LIKE ?
             ORDER BY contribution DESC LIMIT 20`,
            [like, like, q, like]
        );
        res.json({ users: rows });
    } catch (e) {
        logger.error('搜索成员失败:', e.message);
        res.status(500).json({ error: '搜索失败' });
    }
});

// 上传材料
router.post('/admin/materials', authMiddleware, adminMiddleware, uploadMem.array('files', 10), async (req, res) => {
    try {
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ error: '未收到文件' });
        if (!donationUpload.ready()) return res.status(503).json({ error: '对象存储未配置' });

        const out = [];
        for (const f of files) {
            const kind = donationUpload.classify(f.mimetype, f.originalname);
            if (!kind) return res.status(400).json({ error: `不支持的文件类型：${f.originalname}` });
            if (kind === 'image' && f.size > 5 * 1024 * 1024) {
                return res.status(400).json({ error: `图片不能超过 5MB：${f.originalname}` });
            }
            if (kind === 'pdf' && f.size > 20 * 1024 * 1024) {
                return res.status(400).json({ error: `PDF 不能超过 20MB：${f.originalname}` });
            }
            // eslint-disable-next-line no-await-in-loop
            const m = await donationUpload.uploadMaterial(f);
            const isPublic = String(req.body.public) === 'true' || String(req.body.public) === '1';
            out.push({ ...m, public: isPublic });
        }
        res.status(201).json({ success: true, materials: out });
    } catch (e) {
        logger.error('上传捐赠材料失败:', e.message);
        res.status(500).json({ error: e.message || '上传失败' });
    }
});

// 上传/替换收款码
router.post('/admin/qr', authMiddleware, adminMiddleware, uploadMem.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '未收到文件' });
        if (!donationUpload.ready()) return res.status(503).json({ error: '对象存储未配置' });
        const old = await donation.getQrUrl();
        const url = await donationUpload.uploadQr(req.file);
        await donation.setQrUrl(url);
        // 回收旧收款码
        if (old && old !== url) {
            try {
                const chatUpload = require('../lib/chat-upload');
                await chatUpload.deleteByUrls([old]);
            } catch (e2) { /* 忽略 */ }
        }
        logger.info(`收款码已更新 by=${req.userId}`);
        res.status(201).json({ success: true, qrUrl: url });
    } catch (e) {
        logger.error('上传收款码失败:', e.message);
        res.status(500).json({ error: e.message || '上传失败' });
    }
});

// 新增账目
router.post('/admin/entry', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const r = await donation.createEntry(req.body || {}, req.userId);
        if (r.error) return res.status(400).json({ error: r.error });
        res.status(201).json({ success: true, ...r });
    } catch (e) {
        logger.error('新增捐赠账目失败:', e.message);
        res.status(500).json({ error: '新增失败' });
    }
});

// 编辑账目
router.put('/admin/entry/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const r = await donation.updateEntry(parseInt(req.params.id), req.body || {}, req.userId);
        if (r.error) return res.status(400).json({ error: r.error });
        res.json({ success: true, ...r });
    } catch (e) {
        logger.error('编辑捐赠账目失败:', e.message);
        res.status(500).json({ error: '编辑失败' });
    }
});

// 删除账目
router.delete('/admin/entry/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const r = await donation.deleteEntry(parseInt(req.params.id), req.userId);
        if (r.error) return res.status(400).json({ error: r.error });
        res.json({ success: true, ...r });
    } catch (e) {
        logger.error('删除捐赠账目失败:', e.message);
        res.status(500).json({ error: '删除失败' });
    }
});

// ============ 导出 Excel ============

router.get('/export/xlsx', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { start, end, direction } = req.query;
        const params = [];
        const where = [];
        if (start) { where.push('d.occurred_on >= ?'); params.push(String(start).slice(0, 10)); }
        if (end) { where.push('d.occurred_on <= ?'); params.push(String(end).slice(0, 10)); }
        if (direction === 'in' || direction === 'out') { where.push('d.direction = ?'); params.push(direction); }
        const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

        const rows = await db.all(
            `SELECT d.*, u.username, u.nickname FROM donation_ledger d
             LEFT JOIN users u ON u.id = d.user_id ${w}
             ORDER BY d.occurred_on ASC, d.id ASC`,
            params
        );
        const donors = await donation.listDonors({ page: 1, limit: 1000 });
        const s = await donation.summary();

        const wb = XLSX.utils.book_new();

        const rangeText = (start || end)
            ? `${start || '不限'} ~ ${end || '不限'}`
            : '全部';

        // Sheet1 汇总
        const ws1 = XLSX.utils.aoa_to_sheet([
            ['玄剑公会 捐赠墙公账汇总'],
            [`统计范围：${rangeText}`],
            [],
            ['项目', '数值'],
            ['累计收入（元）', s.income],
            ['累计支出（元）', s.expense],
            ['公账余额（元）', s.balance],
            ['入账笔数', s.inCount],
            ['支出笔数', s.outCount],
            ['累计发放贡献点', s.pointsTotal],
        ]);
        ws1['!cols'] = [{ wch: 22 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, ws1, '公账汇总');

        // Sheet2 出入账明细
        const d2 = [['序号', '类型', '日期', '捐赠人', '金额(元)', '比例(点/元)', '发放贡献点', '用处', '备注', '材料数', '录入人']];
        rows.forEach((r, i) => {
            d2.push([
                i + 1,
                r.direction === 'in' ? '入账' : '支出',
                r.occurred_on,
                r.direction === 'in' ? (r.is_public ? (r.nickname || r.username || '') : '匿名捐赠者') : '',
                donation.r2(r.amount),
                r.direction === 'in' ? donation.r2(r.ratio) : '',
                r.direction === 'in' ? donation.r2(r.points) : '',
                r.purpose || '',
                r.note || '',
                donation.parseMaterials(r.materials).length,
                '',
            ]);
        });
        const ws2 = XLSX.utils.aoa_to_sheet(d2);
        ws2['!cols'] = [{ wch: 6 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 24 }, { wch: 8 }, { wch: 10 }];
        XLSX.utils.book_append_sheet(wb, ws2, '出入账明细');

        // Sheet3 捐赠者汇总
        const d3 = [['序号', '捐赠人', '累计捐赠(元)', '累计发放贡献点', '捐赠次数', '最近捐赠']];
        donors.list.forEach((d, i) => {
            d3.push([i + 1, d.nickname, d.totalAmount, d.totalPoints, d.times, d.lastOn || '']);
        });
        const ws3 = XLSX.utils.aoa_to_sheet(d3);
        ws3['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws3, '捐赠者汇总');

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const fname = `捐赠墙公账-${(start || 'all')}_${(end || 'all')}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`);
        res.send(buf);
    } catch (e) {
        logger.error('导出捐赠 Excel 失败:', e.message);
        res.status(500).json({ error: '导出失败' });
    }
});

module.exports = router;
