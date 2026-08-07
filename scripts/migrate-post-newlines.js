// 迁移：将纯文本（无 HTML 标签）帖子中的换行符 \n 转为 <br>，与前端 normalizeRichContent 逻辑一致
const db = require('../database');

const run = async () => {
    try {
        // 统计纯文本且含换行的帖子
        const candidates = await db.all(
            `SELECT id, content FROM posts
             WHERE status = 'active'
               AND content NOT LIKE '%<%'
               AND content LIKE '%' || char(10) || '%'`
        );
        console.log(`待迁移帖子数: ${candidates.length}`);

        let updated = 0;
        for (const p of candidates) {
            const newContent = p.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
            if (newContent !== p.content) {
                await db.run(
                    'UPDATE posts SET content = ?, updated_at = ? WHERE id = ?',
                    [newContent, db.getLocalTimestamp(), p.id]
                );
                updated++;
            }
        }
        console.log(`已迁移 ${updated} 条帖子的换行符`);

        db.close();
        process.exit(0);
    } catch (e) {
        console.error('迁移失败:', e);
        process.exit(1);
    }
};

run();
