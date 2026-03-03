const express = require('express');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const router = express.Router();

/**
 * 处理图片路径
 * 相对路径保持不变（浏览器自动使用当前协议）
 * Base64 和完整 URL 保持原样
 */
function processImages(images) {
    if (!images || !Array.isArray(images)) return [];
    
    return images.map(img => {
        // 如果已经是 Base64、完整 URL 或相对路径，保持原样
        if (img.startsWith('data:') || img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/')) {
            return img;
        }
        // 其他情况添加 / 前缀
        return `/${img}`;
    });
}

// 获取公开统计数据（首页展示用，无需登录）
// 注意：此路由必须在 /:id 之前定义，否则会被 :id 参数匹配
router.get('/public-stats', async (req, res) => {
    try {
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        const postCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE status = "active"');
        const commentCount = await db.get('SELECT COUNT(*) as count FROM comments WHERE status = "active"');
        
        res.json({
            users: userCount.count,
            posts: postCount.count,
            comments: commentCount.count
        });
    } catch (error) {
        console.error('获取统计数据错误:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

// 获取内容列表
router.get('/', async (req, res) => {
    try {
        const { type, page = 1, limit = 10, search, tag, author } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE p.status = "active"';
        const params = [];
        
        if (type) {
            whereClause += ' AND p.type = ?';
            params.push(type);
        }
        
        if (search) {
            whereClause += ' AND (p.title LIKE ? OR p.content LIKE ? OR p.tags LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        if (tag) {
            whereClause += ' AND p.tags LIKE ?';
            params.push(`%${tag}%`);
        }
        
        if (author) {
            whereClause += ' AND u.username = ?';
            params.push(author);
        }
        
        // 获取总数
        const countResult = await db.get(
            `SELECT COUNT(*) as total FROM posts p 
             LEFT JOIN users u ON p.author_id = u.id ${whereClause}`,
            params
        );
        
        // 获取列表
        const posts = await db.all(
            `SELECT p.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username
             FROM posts p
             LEFT JOIN users u ON p.author_id = u.id
             ${whereClause}
             ORDER BY p.is_pinned DESC, p.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );
        
        // 解析图片JSON并处理为完整URL
        posts.forEach(post => {
            if (post.images) {
                try {
                    const images = JSON.parse(post.images);
                    post.images = processImages(images);
                } catch {
                    post.images = [];
                }
            } else {
                post.images = [];
            }
        });
        
        res.json({
            posts,
            total: countResult.total,
            page: parseInt(page),
            totalPages: Math.ceil(countResult.total / limit)
        });
    } catch (error) {
        console.error('获取内容列表错误:', error);
        res.status(500).json({ error: '获取内容列表失败' });
    }
});

// 获取单条内容详情
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 获取内容详情
        const post = await db.get(
            `SELECT p.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username, u.contribution as author_contribution
             FROM posts p
             LEFT JOIN users u ON p.author_id = u.id
             WHERE p.id = ? AND p.status = 'active'`,
            [id]
        );
        
        if (!post) {
            return res.status(404).json({ error: '内容不存在' });
        }
        
        // 解析图片JSON并处理为完整URL
        if (post.images) {
            try {
                const images = JSON.parse(post.images);
                post.images = processImages(images);
            } catch {
                post.images = [];
            }
        } else {
            post.images = [];
        }
        
        // 增加浏览量
        await db.run('UPDATE posts SET views = views + 1 WHERE id = ?', [id]);
        post.views++;
        
        // 递归获取评论回复（支持多级嵌套）
        async function getReplies(parentId, depth = 0) {
            if (depth > 2) return []; // 限制最大嵌套层级为3层
            
            const replies = await db.all(
                `SELECT c.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username
                 FROM comments c
                 LEFT JOIN users u ON c.author_id = u.id
                 WHERE c.parent_id = ? AND c.status = 'active'
                 ORDER BY c.created_at ASC`,
                [parentId]
            );
            
            for (let reply of replies) {
                // 获取回复对象信息
                const parentComment = await db.get(
                    `SELECT u.nickname, u.username 
                     FROM comments c 
                     JOIN users u ON c.author_id = u.id 
                     WHERE c.id = ?`,
                    [reply.parent_id]
                );
                if (parentComment) {
                    reply.reply_to = parentComment;
                }
                // 递归获取子回复
                reply.replies = await getReplies(reply.id, depth + 1);
            }
            
            return replies;
        }
        
        // 获取顶级评论
        const comments = await db.all(
            `SELECT c.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username
             FROM comments c
             LEFT JOIN users u ON c.author_id = u.id
             WHERE c.post_id = ? AND c.status = 'active' AND c.parent_id IS NULL
             ORDER BY c.created_at DESC`,
            [id]
        );
        
        // 为每个评论获取回复
        for (let comment of comments) {
            comment.replies = await getReplies(comment.id);
        }
        
        res.json({ post, comments });
    } catch (error) {
        console.error('获取内容详情错误:', error);
        res.status(500).json({ error: '获取内容详情失败' });
    }
});

// 发布内容
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { title, content, type, tags, images } = req.body;
        
        // 验证输入
        if (!title || !content || !type) {
            return res.status(400).json({ error: '标题、内容和类型不能为空' });
        }
        
        // 检查发布权限
        const user = await db.get('SELECT level FROM users WHERE id = ?', [req.userId]);
        
        // 日报和决策需要管理员权限
        if ((type === 'daily' || type === 'decision') && user.level < 1) {
            return res.status(403).json({ error: '权限不足，无法发布此类型内容' });
        }
        
        const result = await db.run(
            'INSERT INTO posts (title, content, type, author_id, tags, images, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [title, content, type, req.userId, tags, JSON.stringify(images || []), getLocalTimestamp(), getLocalTimestamp()]
        );

        // 增加用户贡献点
        await db.run('UPDATE users SET contribution = contribution + 5 WHERE id = ?', [req.userId]);

        // 为日报和决策创建通知给所有用户
        if (type === 'daily' || type === 'decision') {
            const typeText = type === 'daily' ? '日报' : '决策';
            const allUsers = await db.all('SELECT id FROM users WHERE id != ?', [req.userId]);
            for (const u of allUsers) {
                await createNotification({
                    userId: u.id,
                    type: type === 'daily' ? 'post_daily' : 'post_decision',
                    title: `新的${typeText}发布`,
                    content: title,
                    postId: result.id,
                    actorId: req.userId
                });
            }
        }

        res.status(201).json({
            message: '发布成功',
            postId: result.id
        });
    } catch (error) {
        console.error('发布内容错误:', error);
        res.status(500).json({ error: '发布内容失败' });
    }
});

// 更新内容
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, tags, images } = req.body;
        
        // 检查内容是否存在
        const post = await db.get('SELECT author_id FROM posts WHERE id = ?', [id]);
        if (!post) {
            return res.status(404).json({ error: '内容不存在' });
        }
        
        // 检查权限（作者或管理员可以编辑）
        const user = await db.get('SELECT level FROM users WHERE id = ?', [req.userId]);
        if (post.author_id !== req.userId && user.level < 1) {
            return res.status(403).json({ error: '权限不足' });
        }
        
        await db.run(
            'UPDATE posts SET title = ?, content = ?, tags = ?, images = ?, updated_at = ? WHERE id = ?',
            [title, content, tags, JSON.stringify(images || []), getLocalTimestamp(), id]
        );
        
        res.json({ message: '更新成功' });
    } catch (error) {
        console.error('更新内容错误:', error);
        res.status(500).json({ error: '更新内容失败' });
    }
});

// 删除内容
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 检查内容是否存在
        const post = await db.get('SELECT author_id FROM posts WHERE id = ?', [id]);
        if (!post) {
            return res.status(404).json({ error: '内容不存在' });
        }
        
        // 检查权限（作者或管理员可以删除）
        const user = await db.get('SELECT level FROM users WHERE id = ?', [req.userId]);
        if (post.author_id !== req.userId && user.level < 1) {
            return res.status(403).json({ error: '权限不足' });
        }
        
        await db.run('UPDATE posts SET status = "deleted" WHERE id = ?', [id]);
        
        res.json({ message: '删除成功' });
    } catch (error) {
        console.error('删除内容错误:', error);
        res.status(500).json({ error: '删除内容失败' });
    }
});

// 点赞/取消点赞
router.post('/:id/like', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 检查是否已点赞
        const existingLike = await db.get(
            'SELECT id FROM likes WHERE post_id = ? AND user_id = ?',
            [id, req.userId]
        );
        
        if (existingLike) {
            // 取消点赞
            await db.run('DELETE FROM likes WHERE id = ?', [existingLike.id]);
            await db.run('UPDATE posts SET likes = likes - 1 WHERE id = ?', [id]);
            res.json({ liked: false });
        } else {
            // 点赞
            await db.run('INSERT INTO likes (post_id, user_id) VALUES (?, ?)', [id, req.userId]);
            await db.run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [id]);

            // 创建通知给帖子作者
            const post = await db.get('SELECT author_id, title FROM posts WHERE id = ?', [id]);
            if (post && post.author_id !== req.userId) {
                await createNotification({
                    userId: post.author_id,
                    type: 'like',
                    title: '你的帖子收到新点赞',
                    content: post.title,
                    postId: id,
                    actorId: req.userId
                });
            }

            res.json({ liked: true });
        }
    } catch (error) {
        console.error('点赞错误:', error);
        res.status(500).json({ error: '操作失败' });
    }
});

// 添加评论
router.post('/:id/comments', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { content, parentId } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: '评论内容不能为空' });
        }
        
        const result = await db.run(
            'INSERT INTO comments (post_id, author_id, content, parent_id) VALUES (?, ?, ?, ?)',
            [id, req.userId, content, parentId || null]
        );

        // 更新评论数
        await db.run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [id]);

        // 增加用户贡献点
        await db.run('UPDATE users SET contribution = contribution + 1 WHERE id = ?', [req.userId]);

        // 创建通知给帖子作者
        const post = await db.get('SELECT author_id, title FROM posts WHERE id = ?', [id]);
        if (post && post.author_id !== req.userId) {
            await createNotification({
                userId: post.author_id,
                type: 'comment',
                title: '你的帖子收到新评论',
                content: post.title,
                postId: id,
                commentId: result.id,
                actorId: req.userId
            });
        }

        // 如果是回复评论，通知被回复者
        if (parentId) {
            const parentComment = await db.get('SELECT author_id FROM comments WHERE id = ?', [parentId]);
            if (parentComment && parentComment.author_id !== req.userId && parentComment.author_id !== post.author_id) {
                await createNotification({
                    userId: parentComment.author_id,
                    type: 'comment',
                    title: '有人回复了你的评论',
                    content: post.title,
                    postId: id,
                    commentId: result.id,
                    actorId: req.userId
                });
            }
        }

        res.status(201).json({
            message: '评论成功',
            commentId: result.id
        });
    } catch (error) {
        console.error('添加评论错误:', error);
        res.status(500).json({ error: '评论失败' });
    }
});

// 删除评论
router.delete('/:postId/comments/:commentId', authMiddleware, async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        
        // 检查评论是否存在
        const comment = await db.get('SELECT author_id FROM comments WHERE id = ?', [commentId]);
        if (!comment) {
            return res.status(404).json({ error: '评论不存在' });
        }
        
        // 检查权限
        const user = await db.get('SELECT level FROM users WHERE id = ?', [req.userId]);
        if (comment.author_id !== req.userId && user.level < 1) {
            return res.status(403).json({ error: '权限不足' });
        }
        
        await db.run('UPDATE comments SET status = "deleted" WHERE id = ?', [commentId]);
        await db.run('UPDATE posts SET comments_count = comments_count - 1 WHERE id = ?', [postId]);
        
        res.json({ message: '删除成功' });
    } catch (error) {
        console.error('删除评论错误:', error);
        res.status(500).json({ error: '删除评论失败' });
    }
});

module.exports = router;
