/**
 * 修复 Base64 图片存储
 * 将数据库中的 Base64 图片转换为文件存储
 */

const fs = require('fs');
const path = require('path');
const db = require('../database');

const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * 从 Base64 保存文件
 */
function saveBase64File(base64String, filename) {
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filepath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, buffer);
    return filename;
}

/**
 * 获取文件扩展名
 */
function getExtension(base64String) {
    const match = base64String.match(/^data:image\/(\w+);base64,/);
    if (match) {
        return match[1] === 'jpeg' ? 'jpg' : match[1];
    }
    return 'png';
}

/**
 * 修复单个帖子
 */
async function fixPost(postId, imagesJson) {
    try {
        const images = JSON.parse(imagesJson);
        if (!Array.isArray(images)) return null;

        const newImages = [];
        let hasChanges = false;

        for (let i = 0; i < images.length; i++) {
            const img = images[i];

            if (img.startsWith('data:image')) {
                hasChanges = true;
                const ext = getExtension(img);
                const filename = `fixed_${postId}_${Date.now()}_${i}.${ext}`;
                
                saveBase64File(img, filename);
                newImages.push(`/uploads/${filename}`);
                console.log(`  ✓ 转换图片 ${i}: ${filename}`);
            } else {
                newImages.push(img);
            }
        }

        if (hasChanges) {
            await db.run(
                'UPDATE posts SET images = ? WHERE id = ?',
                [JSON.stringify(newImages), postId]
            );
            return newImages;
        }

        return null;
    } catch (error) {
        console.error(`  ✗ 修复失败:`, error.message);
        return null;
    }
}

/**
 * 主函数
 */
async function main() {
    console.log('=== Base64 图片修复工具 ===\n');

    try {
        // 查找包含 Base64 的帖子
        const posts = await db.all(
            "SELECT id, title, images FROM posts WHERE images LIKE '%data:image%'"
        );

        console.log(`找到 ${posts.length} 个包含 Base64 图片的帖子\n`);

        for (const post of posts) {
            console.log(`修复帖子 #${post.id}: ${post.title?.substr(0, 30) || '无标题'}...`);
            
            const result = await fixPost(post.id, post.images);
            
            if (result) {
                console.log(`  ✓ 已修复\n`);
            } else {
                console.log(`  - 无需修复\n`);
            }
        }

        console.log('=== 修复完成 ===');
        console.log(`图片保存位置: ${UPLOADS_DIR}`);

    } catch (error) {
        console.error('修复过程出错:', error);
    } finally {
        process.exit(0);
    }
}

main();
