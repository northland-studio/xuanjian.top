/**
 * Base64 图片转换脚本
 * 将数据库中存储的 Base64 图片转换为文件，并更新数据库为 URL
 */

const fs = require('fs');
const path = require('path');
const db = require('../database');

// 配置
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');
const SERVER_URL = process.env.SERVER_URL || 'http://115.190.153.44';

// 确保上传目录存在
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * 从 Base64 数据中提取文件扩展名
 */
function getExtensionFromBase64(base64String) {
    const match = base64String.match(/^data:image\/(\w+);base64,/);
    if (match) {
        const ext = match[1];
        // 处理 jpeg -> jpg
        return ext === 'jpeg' ? 'jpg' : ext;
    }
    return 'png'; // 默认
}

/**
 * 保存 Base64 图片到文件
 */
function saveBase64ToFile(base64String, filename) {
    // 移除 Base64 前缀
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filepath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    return filename;
}

/**
 * 转换单个帖子的图片
 */
async function convertPostImages(postId, imagesJson) {
    try {
        const images = JSON.parse(imagesJson);
        if (!Array.isArray(images) || images.length === 0) {
            return null;
        }

        const newImages = [];
        let hasBase64 = false;

        for (const img of images) {
            // 如果已经是 URL，保持不变
            if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/uploads/')) {
                newImages.push(img);
                continue;
            }

            // 处理 Base64
            if (img.startsWith('data:image')) {
                hasBase64 = true;
                const ext = getExtensionFromBase64(img);
                const filename = `converted_${postId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
                
                saveBase64ToFile(img, filename);
                newImages.push(`/uploads/${filename}`);
                console.log(`  ✓ 转换图片: ${filename}`);
            } else {
                // 其他格式，保持不变
                newImages.push(img);
            }
        }

        // 如果有 Base64 被转换，更新数据库
        if (hasBase64) {
            await db.run(
                'UPDATE posts SET images = ? WHERE id = ?',
                [JSON.stringify(newImages), postId]
            );
            return newImages;
        }

        return null;
    } catch (error) {
        console.error(`  ✗ 转换失败 (post ${postId}):`, error.message);
        return null;
    }
}

/**
 * 主函数
 */
async function main() {
    console.log('========================================');
    console.log('   Base64 图片转换工具');
    console.log('========================================\n');

    try {
        // 获取所有包含图片的帖子
        const posts = await db.all(
            "SELECT id, title, images FROM posts WHERE images IS NOT NULL AND images != '[]'"
        );

        console.log(`找到 ${posts.length} 个包含图片的帖子\n`);

        let convertedCount = 0;
        let skippedCount = 0;

        for (const post of posts) {
            console.log(`处理帖子 #${post.id}: ${post.title?.substr(0, 30) || '无标题'}...`);
            
            const result = await convertPostImages(post.id, post.images);
            
            if (result) {
                convertedCount++;
                console.log(`  ✓ 已更新数据库\n`);
            } else {
                skippedCount++;
                console.log(`  - 无需转换或已是 URL\n`);
            }
        }

        console.log('========================================');
        console.log('   转换完成!');
        console.log('========================================');
        console.log(`总帖子数: ${posts.length}`);
        console.log(`已转换: ${convertedCount}`);
        console.log(`跳过: ${skippedCount}`);
        console.log(`\n图片保存位置: ${UPLOADS_DIR}`);
        console.log(`\n提示: 转换后的图片可通过 ${SERVER_URL}/uploads/ 访问`);

    } catch (error) {
        console.error('转换过程出错:', error);
    } finally {
        process.exit(0);
    }
}

// 运行
main();
