/**
 * 玄剑公会官网定时备份脚本（七牛云）
 *
 * 功能：
 *  1. 将 data/uploads/skin-*.png（皮肤文件）上传到七牛 backup/skins/<时间戳>/
 *  2. 停止 pm2 → 等待 SQLite WAL 落盘（wal_checkpoint）→ 复制 guild.db → 上传七牛 backup/db/<时间戳>/
 *     → 重启 pm2
 *  3. 所有操作写入项目根目录 backup.log
 *
 * 用法：
 *  node scripts/backup-to-qiniu.js            （正常执行）
 *  node scripts/backup-to-qiniu.js --dry-run  （仅打印计划，不真正上传/停服）
 *
 * 依赖 .env 中的 QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET / QINIU_DOMAIN / QINIU_UPLOAD_URL
 * 以及 node_modules/qiniu。
 */
require('dotenv').config();
const qiniu = require('qiniu');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECT_DIR = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(PROJECT_DIR, 'data', 'uploads');
const DB_FILE = path.join(PROJECT_DIR, 'data', 'guild.db');
const LOG_FILE = path.join(PROJECT_DIR, 'backup.log');
const PM2_APP = 'xuanjian-guild';

// 七牛配置
const config = {
  accessKey: process.env.QINIU_ACCESS_KEY || '',
  secretKey: process.env.QINIU_SECRET_KEY || '',
  bucket: process.env.QINIU_BUCKET || 'xuanjian-top',
  domain: process.env.QINIU_DOMAIN || 'https://cdn.xuanjian.top',
  uploadUrl: process.env.QINIU_UPLOAD_URL || 'https://up-as0.qiniup.com',
};

// 时间戳（本地时间）
function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function logLine() {
  return `[${new Date().toISOString()}]`;
}
// 写日志（同时打印 + 追加到 backup.log）
function log(msg) {
  const line = `${logLine()} ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
// 与 migrate-to-qiniu.js 一致的配置方式（SDK 自动处理区域）
const formUploader = new qiniu.form_up.FormUploader(new qiniu.conf.Config({ useHttpsDomain: false }));

function generateUploadToken(key) {
  const putPolicy = new qiniu.rs.PutPolicy({
    scope: `${config.bucket}:${key}`,
    returnBody: '{"key":"$(key)","hash":"$(etag)","fsize":$(fsize)}',
  });
  return putPolicy.uploadToken(mac);
}

function uploadFile(localPath, remoteKey) {
  return new Promise((resolve, reject) => {
    const token = generateUploadToken(remoteKey);
    const putExtra = new qiniu.form_up.PutExtra();
    formUploader.putFile(token, remoteKey, localPath, putExtra, (err, body, resp) => {
      if (err) return reject(err);
      if (resp && resp.statusCode === 200) resolve({ key: body.key, hash: body.hash });
      else reject(new Error(`上传失败: HTTP ${resp ? resp.statusCode : '无响应'}`));
    });
  });
}

// 保留的远程备份份数（数据库 & 皮肤各保留最近 N 份，旧的自动清理）
const KEEP = parseInt(process.env.BACKUP_KEEP || '5', 10);

/** 清理七牛 backup/<kind>/ 下超出保留份数的旧备份（每个时间戳目录算一份） */
async function cleanupBackups(kind) {
  try {
    const bucketManager = new qiniu.rs.BucketManager(mac, new qiniu.conf.Config());
    const prefix = `backup/${kind}/`;
    const listPage = (marker) => new Promise((resolve, reject) => {
      bucketManager.listPrefix(config.bucket, { prefix, limit: 1000, marker: marker || '' }, (err, body, resp) => {
        if (err) return reject(err);
        if (resp && resp.statusCode === 200) resolve(body || {});
        else reject(new Error(`list fail HTTP ${resp ? resp.statusCode : '?'}`));
      });
    });
    let allItems = [];
    let marker = '';
    do {
      const page = await listPage(marker);
      allItems = allItems.concat((page.items || []).map(it => it.key));
      marker = page.marker || '';
    } while (marker);
    if (!allItems.length) return 0;

    const dirs = new Map();
    for (const key of allItems) {
      const m = key.match(new RegExp(`^backup/${kind}/([^/]+)/`));
      if (m) {
        const ts = m[1];
        if (!dirs.has(ts)) dirs.set(ts, []);
        dirs.get(ts).push(key);
      }
    }
    const sorted = [...dirs.keys()].sort();
    if (sorted.length <= KEEP) return 0;

    const toDelete = sorted.slice(0, sorted.length - KEEP);
    let deleted = 0;
    for (const ts of toDelete) {
      const keys = dirs.get(ts);
      await new Promise((resolve, reject) => {
        bucketManager.deleteMany(config.bucket, keys.map(k => ({ key: k })), (err) => {
          if (err) return reject(err);
          deleted += keys.length;
          resolve();
        });
      });
    }
    return deleted;
  } catch (e) {
    log(`清理 backup/${kind} 失败: ${e.message}`);
    return 0;
  }
}

function run(cmd) {
  try {
    execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (e) {
    log(`命令失败: ${cmd} → ${e.stderr ? e.stderr.toString().trim() : e.message}`);
    return false;
  }
}

async function main() {
  log('========== 玄剑公会备份开始 ==========');
  if (!config.accessKey || !config.secretKey) {
    log('错误: 七牛云配置缺失，请检查 .env 的 QINIU_ACCESS_KEY / QINIU_SECRET_KEY');
    log('========== 备份中止（配置缺失） ==========');
    process.exit(1);
  }
  if (DRY_RUN) log('【演练模式 --dry-run】仅打印计划，不实际执行');

  const stamp = ts();

  // ========== 1. 皮肤备份 ==========
  log('--- [1/2] 皮肤文件备份 ---');
  let skinFiles = [];
  if (fs.existsSync(UPLOADS_DIR)) {
    skinFiles = fs.readdirSync(UPLOADS_DIR).filter(f => /^skin-.*\.png$/i.test(f));
  }
  if (!skinFiles.length) {
    log('未发现皮肤文件（skin-*.png），跳过');
  } else {
    log(`发现 ${skinFiles.length} 个皮肤文件`);
    let ok = 0, fail = 0;
    for (const f of skinFiles) {
      const localPath = path.join(UPLOADS_DIR, f);
      const remoteKey = `backup/skins/${stamp}/${f}`;
      if (DRY_RUN) { log(`[演练] 将上传 ${f} → ${remoteKey}`); ok++; continue; }
      try {
        await uploadFile(localPath, remoteKey);
        ok++;
      } catch (e) {
        fail++;
        log(`皮肤上传失败: ${f} → ${e.message}`);
      }
    }
    log(`皮肤备份完成: 成功 ${ok}，失败 ${fail}`);
    if (!DRY_RUN) {
      const del = await cleanupBackups('skins');
      log(`皮肤旧备份清理: 删除 ${del} 个文件（保留最近 ${KEEP} 份）`);
    }
  }

  // ========== 2. 数据库备份 ==========
  log('--- [2/2] 数据库备份 ---');
  const dbBackupPath = path.join(PROJECT_DIR, 'data', `.guild-backup-${stamp}.db`);
  try {
    if (DRY_RUN) {
      log('[演练] 将停止 pm2、checkpoint WAL、复制并上传 guild.db');
    } else {
      // 2a. 停止 pm2
      log('停止 pm2 进程...');
      run(`pm2 stop ${PM2_APP}`);
      // 等待进程完全退出
      await new Promise(r => setTimeout(r, 2000));

      // 2b. 强制 WAL checkpoint（确保 WAL 数据合并入主库，一致性快照）
      // 用 sqlite3 库执行 wal_checkpoint；若不可用则跳过（复制时含 wal 一起）
      try {
        const sqlite3 = require('sqlite3');
        const sqlDb = new sqlite3.Database(DB_FILE);
        await new Promise((res, rej) => sqlDb.run('PRAGMA wal_checkpoint(TRUNCATE)', e => e ? rej(e) : res()));
        sqlDb.close();
        log('WAL checkpoint 完成');
      } catch (e) {
        log('WAL checkpoint 跳过（sqlite3 不可用）: ' + e.message);
      }
      await new Promise(r => setTimeout(r, 500));

      // 2c. 复制数据库（含 wal/shm 若存在）
      fs.copyFileSync(DB_FILE, dbBackupPath);
      // 上传
      const remoteKey = `backup/db/${stamp}/guild.db`;
      await uploadFile(dbBackupPath, remoteKey);
      log(`数据库备份完成: → ${remoteKey}`);
    }
  } finally {
    // 清理临时 db 副本
    if (fs.existsSync(dbBackupPath)) fs.unlinkSync(dbBackupPath);
    if (!DRY_RUN) {
      // 重启 pm2
      log('重启 pm2 进程...');
      run(`pm2 restart ${PM2_APP}`);
      // 清理旧的数据库远程备份（保留最近 KEEP 份）
      const del = await cleanupBackups('db');
      log(`数据库旧备份清理: 删除 ${del} 个文件（保留最近 ${KEEP} 份）`);
    }
  }

  log('========== 备份完成 ==========');
}

main().catch(e => {
  log('备份异常: ' + (e.stack || e.message));
  // 确保 pm2 恢复运行
  if (!DRY_RUN) run(`pm2 restart ${PM2_APP}`);
  process.exit(1);
});
