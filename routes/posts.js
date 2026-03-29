const express = require('express');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const router = express.Router();

function processImages(images) {
    if (!images || !Array.isArray(images)) return [];
    
    return images.map(img => {
        if (img.startsWith('data:') || img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/')) {
            return img;
        }
        return `/${img}`;
    });
}

router.get('/public-stats', async (req, res) => {
    try {
        const [userCount, postCount, commentCount] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM users'),
            db.get('SELECT COUNT(*) as count FROM posts WHERE status = "active"'),
            db.get('SELECT COUNT(*) as count FROM comments WHERE status = "active"')
        ]);
        
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
        
        const countResult = await db.get(
            `SELECT COUNT(*) as total FROM posts p 
             LEFT JOIN users u ON p.author_id = u.id ${whereClause}`,
            params
        );
        
        const posts = await db.all(
            `SELECT p.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username,
                    t.name as author_title_name, t.color as author_title_color
             FROM posts p
             LEFT JOIN users u ON p.author_id = u.id
             LEFT JOIN titles t ON u.equipped_title = t.id
             ${whereClause}
             ORDER BY p.is_pinned DESC, p.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );
        
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

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const post = await db.get(
            `SELECT p.*, u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username, u.contribution as author_contribution,
                    t.name as author_title_name, t.color as author_title_color
             FROM posts p
             LEFT JOIN users u ON p.author_id = u.id
             LEFT JOIN titles t ON u.equipped_title = t.id
             WHERE p.id = ? AND p.status = 'active'`,
            [id]
        );
        
        if (!post) {
            return res.status(404).json({ error: '内容不存在' });
        }
        
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
        
        await db.run('UPDATE posts SET views = views + 1 WHERE id = ?', [id]);
        post.views++;
        
        const allComments = await db.all(
            `SELECT c.id, c.post_id, c.author_id, c.content, c.parent_id, c.created_at, c.status,
                    u.nickname as author_nickname, u.avatar as author_avatar, u.username as author_username,
                    t.name as author_title_name, t.color as author_title_color
             FROM comments c
             LEFT JOIN users u ON c.author_id = u.id
             LEFT JOIN titles t ON u.equipped_title = t.id
             WHERE c.post_id = ? AND c.status = 'active'
             ORDER BY c.created_at ASC`,
            [id]
        );
        
        const commentMap = new Map();
        allComments.forEach(comment => {
            comment.replies = [];
            commentMap.set(comment.id, comment);
        });
        
        const rootComments = [];
        allComments.forEach(comment => {
            if (comment.parent_id) {
                const parent = commentMap.get(comment.parent_id);
                if (parent) {
                    const parentComment = allComments.find(c => c.id === comment.parent_id);
                    if (parentComment) {
                        comment.reply_to = {
                            nickname: parentComment.author_nickname,
                            username: parentComment.author_username
                        };
                    }
                    parent.replies.push(comment);
                }
            } else {
                rootComments.push(comment);
            }
        });
        
        res.json({ post, comments: rootComments });
    } catch (error) {
        console.error('获取内容详情错误:', error);
        res.status(500).json({ error: '获取内容详情失败' });
    }
});

router.post('/', authMiddleware, async (req, res) => {
    try {
        const { title, content, type, tags, images } = req.body;
        
        if (!title || !content || !type) {
            return res.status(400).json({ error: '标题、内容和类型不能为空' });
        }
        
        const user = await db.get('SELECT level FROM users WHERE id = ?', [req.userId]);
        
        if (type === 'decision' && user.level < 1) {
            return res.status(403).json({ error: '权限不足，无法发布决策' });
        }
        
        if (type === 'daily' && user.level < 1 && user.level !== 3) {
            return res.status(403).json({ error: '权限不足，无法发布日报' });
        }
        
        const result = await db.run(
            'INSERT INTO posts (title, content, type, author_id, tags, images, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [title, content, type, req.userId, tags, JSON.stringify(images || []), getLocalTimestamp(), getLocalTimestamp()]
        );

        await db.run('UPDATE users SET contribution = contribution + 5 WHERE id = ?', [req.userId]);

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

router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, tags, images } = req.body;
        
        const post = await db.get('SELECT author_id FROM posts WHERE id = ?', [id]);
        if (!post) {
            return res.status(404).json({ error: '内容不存在' });
        }
        
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

router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        const post = await db.get('SELECT author_id FROM posts WHERE id = ?', [id]);
        if (!post) {
            return res.status(404).json({ error: '内容不存在' });
        }
        
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

router.post('/:id/like', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        const existingLike = await db.get(
            'SELECT id FROM likes WHERE post_id = ? AND user_id = ?',
            [id, req.userId]
        );
        
        if (existingLike) {
            await db.run('DELETE FROM likes WHERE id = ?', [existingLike.id]);
            await db.run('UPDATE posts SET likes = likes - 1 WHERE id = ?', [id]);
            res.json({ liked: false });
        } else {
            await db.run('INSERT INTO likes (post_id, user_id) VALUES (?, ?)', [id, req.userId]);
            await db.run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [id]);

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

        await db.run('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [id]);

        await db.run('UPDATE users SET contribution = contribution + 1 WHERE id = ?', [req.userId]);

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

router.delete('/:postId/comments/:commentId', authMiddleware, async (req, res) => {
    try {
        const { postId, commentId } = req.params;
        
        const comment = await db.get('SELECT author_id FROM comments WHERE id = ?', [commentId]);
        if (!comment) {
            return res.status(404).json({ error: '评论不存在' });
        }
        
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
