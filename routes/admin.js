const express = require('express');
const logger = require('../lib/logger');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware, superAdminMiddleware, requirePermission, requireAnyPermission } = require('../middleware/auth');
const perms = require('../lib/permissions');
const router = express.Router();

// 获取所有用户（管理员）
router.get('/users', requirePermission('admin.users.view'), async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (search) {
            whereClause += ' AND (username LIKE ? OR nickname LIKE ? OR email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        const users = await db.all(
            `SELECT id, username, nickname, email, level, contribution, avatar, created_at, is_frozen, generation 
             FROM users ${whereClause} 
             ORDER BY created_at DESC 
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );

        // 附加代系解析（手动优先，否则按注册时间自动判定）
        try {
            const { resolveGeneration } = require('../lib/generation');
            for (const u of users) {
                const g = await resolveGeneration(u);
                u.generation_display = g ? g.name : '';
            }
        } catch (e) { /* 代系解析失败不影响用户列表 */ }
        
        const countResult = await db.get(
            `SELECT COUNT(*) as total FROM users ${whereClause}`,
            params
        );
        
        res.json({
            users,
            total: countResult.total,
            page: parseInt(page),
            totalPages: Math.ceil(countResult.total / limit)
        });
    } catch (error) {
        logger.error('获取用户列表错误:', error);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

// 更新用户信息（管理员）
router.put('/users/:id', requirePermission('admin.users.edit'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nickname, email, password } = req.body;
        
        let updates = [];
        let params = [];
        
        if (nickname) {
            updates.push('nickname = ?');
            params.push(nickname);
        }
        
        if (email) {
            updates.push('email = ?');
            params.push(email);
        }
        
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updates.push('password = ?');
            params.push(hashedPassword);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: '没有要更新的字段' });
        }
        
        params.push(getLocalTimestamp(), id);
        
        await db.run(
            `UPDATE users SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`,
            params
        );
        
        res.json({ message: '用户信息更新成功' });
    } catch (error) {
        logger.error('更新用户信息错误:', error);
        res.status(500).json({ error: '更新用户信息失败' });
    }
});

// 设置用户等级（超级管理员）
router.put('/users/:id/level', requirePermission('admin.users.level'), async (req, res) => {
    try {
        const { id } = req.params;
        const level = Number(req.body?.level);

        if (req.body?.level === undefined || !Number.isInteger(level) || level < 0 || level > 2) {
            return res.status(400).json({ error: '无效的用户等级（有效值：0-2）', code: 'VALIDATION_ERROR' });
        }

        const target = await db.get('SELECT id, username, nickname, level FROM users WHERE id = ?', [id]);
        if (!target) return res.status(404).json({ error: '用户不存在', code: 'USER_NOT_FOUND' });
        if (Number(target.level) < 0) return res.status(400).json({ error: '系统账号不能调整等级', code: 'SYSTEM_ACCOUNT' });
        // 超级管理员保护：只有 Level 2 能设置 Level 2；非 Level 2 不能修改任何 Level 2 账号
        if (Number(req.userLevel) < 2 && (level >= 2 || Number(target.level) >= 2)) {
            return res.status(403).json({ error: '只有超级管理员可以管理 Level 2 账号', code: 'SUPER_ADMIN_PROTECTED' });
        }
        // 不允许把最后一个 Level 2 降级（避免权限体系失去最高管理入口）
        if (level < 2 && Number(target.level) >= 2) {
            const supers = await db.get('SELECT COUNT(*) AS c FROM users WHERE level >= 2');
            if (supers.c <= 1) {
                return res.status(400).json({ error: '不能降级最后一个超级管理员', code: 'LAST_SUPER_ADMIN' });
            }
        }

        if (Number(target.level) !== level) {
            await db.run(
                'UPDATE users SET level = ?, updated_at = ? WHERE id = ?',
                [level, getLocalTimestamp(), target.id]
            );
            await perms.audit.record({
                actorId: req.userId, action: 'user_level_update', targetType: 'user', targetId: target.id,
                before: { level: target.level }, after: { level },
                note: '调整用户「' + (target.nickname || target.username) + '」等级 ' + target.level + ' → ' + level,
                ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim()
            });
        }

        res.json({ message: '用户等级设置成功', level, effectiveNextRequest: true });
    } catch (error) {
        logger.error('设置用户等级错误:', error);
        res.status(500).json({ error: '设置用户等级失败' });
    }
});

// 获取所有内容（管理员）
router.get('/posts', requirePermission('admin.posts.moderate'), async (req, res) => {
    try {
        const { page = 1, limit = 20, type, status } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (type) {
            whereClause += ' AND p.type = ?';
            params.push(type);
        }
        
        if (status) {
            whereClause += ' AND p.status = ?';
            params.push(status);
        }
        
        const posts = await db.all(
            `SELECT p.*, u.nickname as author_nickname 
             FROM posts p
             LEFT JOIN users u ON p.author_id = u.id
             ${whereClause}
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );
        
        const countResult = await db.get(
            `SELECT COUNT(*) as total FROM posts p ${whereClause}`,
            params
        );
        
        res.json({
            posts,
            total: countResult.total,
            page: parseInt(page),
            totalPages: Math.ceil(countResult.total / limit)
        });
    } catch (error) {
        logger.error('获取内容列表错误:', error);
        res.status(500).json({ error: '获取内容列表失败' });
    }
});

// 置顶/取消置顶内容
router.put('/posts/:id/pin', requirePermission('admin.posts.moderate'), async (req, res) => {
    try {
        const { id } = req.params;
        const { is_pinned: isPinned } = req.body;
        
        await db.run(
            'UPDATE posts SET is_pinned = ? WHERE id = ?',
            [isPinned ? 1 : 0, id]
        );
        
        res.json({ message: isPinned ? '置顶成功' : '取消置顶成功' });
    } catch (error) {
        logger.error('置顶操作错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 获取公告列表
router.get('/announcements', requireAnyPermission(['announcement.create', 'announcement.edit', 'announcement.delete']), async (req, res) => {
    try {
        const announcements = await db.all(
            `SELECT a.*, u.nickname as creator_nickname 
             FROM announcements a
             LEFT JOIN users u ON a.created_by = u.id
             ORDER BY a.created_at DESC`
        );
        
        res.json({ announcements });
    } catch (error) {
        logger.error('获取公告列表错误:', error);
        res.status(500).json({ error: '获取公告列表失败' });
    }
});

// 创建公告
router.post('/announcements', requirePermission('announcement.create'), async (req, res) => {
    try {
        const { title, content, isPopup, isActive } = req.body;
        
        if (!title || !content) {
            return res.status(400).json({ error: '标题和内容不能为空' });
        }
        
        const result = await db.run(
            'INSERT INTO announcements (title, content, is_popup, is_active, created_by) VALUES (?, ?, ?, ?, ?)',
            [title, content, isPopup ? 1 : 0, isActive ? 1 : 0, req.userId]
        );
        
        res.status(201).json({
            message: '公告创建成功',
            announcementId: result.id
        });
    } catch (error) {
        logger.error('创建公告错误:', error);
        res.status(500).json({ error: '创建公告失败' });
    }
});

// 更新公告
router.put('/announcements/:id', requirePermission('announcement.edit'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, isPopup, isActive } = req.body;

        // 上线（isActive 置真）额外要求 announcement.publish；离线编辑只需 announcement.edit
        if (isActive && !(req.permissionSet && req.permissionSet.has('announcement.publish'))) {
            return res.status(403).json({
                error: '缺少公告发布权限', code: 'PERMISSION_DENIED', required: 'announcement.publish'
            });
        }

        await db.run(
            'UPDATE announcements SET title = ?, content = ?, is_popup = ?, is_active = ?, updated_at = ? WHERE id = ?',
            [title, content, isPopup ? 1 : 0, isActive ? 1 : 0, getLocalTimestamp(), id]
        );
        
        res.json({ message: '公告更新成功' });
    } catch (error) {
        logger.error('更新公告错误:', error);
        res.status(500).json({ error: '更新公告失败' });
    }
});

// 删除公告
router.delete('/announcements/:id', requirePermission('announcement.delete'), async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.run('DELETE FROM announcements WHERE id = ?', [id]);
        
        res.json({ message: '公告删除成功' });
    } catch (error) {
        logger.error('删除公告错误:', error);
        res.status(500).json({ error: '删除公告失败' });
    }
});

// 获取统计数据
router.get('/statistics', requirePermission('admin.statistics.view'), async (req, res) => {
    try {
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        const postCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE status = "active"');
        const commentCount = await db.get('SELECT COUNT(*) as count FROM comments WHERE status = "active"');
        const dailyCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE type = "daily" AND status = "active"');
        const decisionCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE type = "decision" AND status = "active"');
        const forumCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE type = "forum" AND status = "active"');
        
        // 获取最近7天的发布统计
        const recentPosts = await db.all(
            `SELECT DATE(created_at) as date, COUNT(*) as count 
             FROM posts 
             WHERE created_at >= DATE('now', '-7 days')
             GROUP BY DATE(created_at)
             ORDER BY date`
        );
        
        res.json({
            users: userCount.count,
            posts: postCount.count,
            comments: commentCount.count,
            daily: dailyCount.count,
            decisions: decisionCount.count,
            forums: forumCount.count,
            recentPosts
        });
    } catch (error) {
        logger.error('获取统计数据错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

// 数据可视化看板（v2.2.0）
router.get('/dashboard', requirePermission('admin.dashboard.view'), async (req, res) => {
    try {
        // 贡献点总量与今日变动
        const totalContribution = await db.get(
            'SELECT COALESCE(SUM(COALESCE(contribution, 0)), 0) AS total FROM users'
        );
        const todayCheckins = await db.get(
            "SELECT COUNT(*) AS count FROM checkins WHERE checkin_date = DATE('now', 'localtime')"
        );

        // 近7天贡献点流动（按天）
        const contributionFlow = await db.all(
            `SELECT DATE(created_at) AS date, SUM(amount) AS amount
             FROM contribution_logs
             WHERE created_at >= DATETIME('now', '-7 days')
             GROUP BY DATE(created_at)
             ORDER BY date`
        );

        // 贡献点变动类型分布
        const contributionByType = await db.all(
            `SELECT type, COUNT(*) AS count, SUM(amount) AS amount
             FROM contribution_logs
             WHERE created_at >= DATETIME('now', '-30 days')
             GROUP BY type
             ORDER BY amount DESC`
        );

        // 近7天新增用户
        const userGrowth = await db.all(
            `SELECT DATE(created_at) AS date, COUNT(*) AS count
             FROM users
             WHERE created_at >= DATETIME('now', '-7 days')
             GROUP BY DATE(created_at)
             ORDER BY date`
        );

        // 贡献点排行 Top 8
        const topContributors = await db.all(
            `SELECT id, nickname, username, avatar, contribution
             FROM users
             ORDER BY contribution DESC
             LIMIT 8`
        );

        // 全站浏览量（今日 / 总量 / 近7天趋势）
        const todayViews = await db.get(
            "SELECT COALESCE(SUM(pv), 0) AS pv FROM page_views WHERE date = DATE('now', 'localtime')"
        );
        const totalViews = await db.get(
            'SELECT COALESCE(SUM(pv), 0) AS pv FROM page_views'
        );
        const viewsTrend = await db.all(
            `SELECT date, pv FROM page_views
             WHERE date >= DATE('now', 'localtime', '-6 days')
             ORDER BY date`
        );

        res.json({
            totalContribution: totalContribution.total,
            todayCheckins: todayCheckins.count,
            contributionFlow,
            contributionByType,
            userGrowth,
            topContributors,
            todayViews: todayViews.pv,
            totalViews: totalViews.pv,
            viewsTrend
        });
    } catch (error) {
        logger.error('获取看板数据错误:', error);
        res.status(500).json({ error: '获取看板数据失败' });
    }
});

// 获取主题设置
router.get('/theme', async (req, res) => {
    try {
        const setting = await db.get('SELECT value FROM settings WHERE key = ?', ['site_theme']);
        res.json({ theme: setting?.value || 'default' });
    } catch (error) {
        logger.error('获取主题设置错误:', error);
        res.status(500).json({ error: '获取主题设置失败' });
    }
});

// 设置主题（管理员）
router.put('/theme', requirePermission('admin.theme.manage'), async (req, res) => {
    try {
        const { theme } = req.body;
        
        const validThemes = ['default', 'spring', 'dragonboat', 'midautumn', 'national'];
        if (!validThemes.includes(theme)) {
            return res.status(400).json({ error: '无效的主题名称' });
        }
        
        // 使用 REPLACE 语法插入或更新
        await db.run(
            'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
            ['site_theme', theme, getLocalTimestamp()]
        );
        
        res.json({ message: '主题设置成功', theme });
    } catch (error) {
        logger.error('设置主题错误:', error);
        res.status(500).json({ error: '设置主题失败' });
    }
});

module.exports = router;
