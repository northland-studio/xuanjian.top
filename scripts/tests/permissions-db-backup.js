/**
 * 部署前一致快照备份（VACUUM INTO，WAL 安全）
 * 用法：node perm-dbbackup.js <目标文件>
 */
const path = require('path');
const fs = require('fs');
const APP = process.cwd();
const target = process.argv[2];
if (!target) { console.error('缺少目标路径'); process.exit(1); }
fs.mkdirSync(path.dirname(target), { recursive: true });
const sqlite3 = require(path.join(APP, 'node_modules', 'sqlite3')).verbose();
const db = new sqlite3.Database(path.join(APP, 'data', 'guild.db'));
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`, (e) => {
    if (e) { console.error('备份失败:', e.message); process.exit(1); }
    db.close(() => {
        console.log('DB_BACKUP_OK ' + target + ' ' + fs.statSync(target).size);
        process.exit(0);
    });
});
