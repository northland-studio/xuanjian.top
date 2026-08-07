/**
 * v2.3.1 全站浏览量统计迁移
 * 创建 page_views 表：按天记录页面浏览量（PV）
 *
 * 运行：node scripts/migrate-page-views.js
 */
require('dotenv').config();
const db = require('../database');

(async () => {
    await db.run(`CREATE TABLE IF NOT EXISTS page_views (
        date TEXT PRIMARY KEY,
        pv INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('[完成] page_views 表就绪（全站浏览量统计）');
    db.close();
})();
