/**
 * 检查数据库中 Base64 图片的脚本
 */
const db = require('./database');

async function checkBase64Images() {
    console.log('=== 检查 Base64 图片存储 ===\n');
    
    try {
        // 获取所有包含图片的帖子
        const posts = await db.all(
            "SELECT id, title, images FROM posts WHERE images IS NOT NULL AND images != '[]' LIMIT 5"
        );
        
        console.log(`找到 ${posts.length} 个包含图片的帖子\n`);
        
        let base64Count = 0;
        let urlCount = 0;
        
        for (const post of posts) {
            console.log(`帖子 #${post.id}: ${post.title?.substr(0, 30) || '无标题'}`);
            
            try {
                const images = JSON.parse(post.images);
                
                for (let i = 0; i < images.length; i++) {
                    const img = images[i];
                    
                    if (img.startsWith('data:image')) {
                        base64Count++;
                        const size = Math.round(img.length / 1024);
                        console.log(`  [${i}] Base64 - ${size}KB`);
                    } else if (img.startsWith('/uploads/') || img.startsWith('http')) {
                        urlCount++;
                        console.log(`  [${i}] URL - ${img}`);
                    } else {
                        console.log(`  [${i}] 其他格式 - ${img.substr(0, 50)}...`);
                    }
                }
            } catch (e) {
                console.log(`  解析失败: ${e.message}`);
            }
            
            console.log('');
        }
        
        console.log('=== 统计 ===');
        console.log(`Base64 图片: ${base64Count}`);
        console.log(`URL 图片: ${urlCount}`);
        
        // 统计总数
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN images LIKE '%data:image%' THEN 1 ELSE 0 END) as base64_posts
            FROM posts 
            WHERE images IS NOT NULL AND images != '[]'
        `);
        
        console.log(`\n总帖子数: ${stats.total}`);
        console.log(`含 Base64 的帖子: ${stats.base64_posts}`);
        
    } catch (error) {
        console.error('检查失败:', error);
    } finally {
        process.exit(0);
    }
}

checkBase64Images();
