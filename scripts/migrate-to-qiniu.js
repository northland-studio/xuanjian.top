/**
 * 七牛云图片迁移脚本（玄剑公会官网）
 * 将服务器本地 data/uploads/ 的图片迁移到七牛云对象存储 xuanjian-top
 * 并更新数据库中的 /uploads/ 路径为 https://cdn.xuanjian.top/images/...
 *
 * 使用方法：
 * 1. 确保 .env 中配置了七牛云密钥（QINIU_ACCESS_KEY / QINIU_SECRET_KEY）
 * 2. node scripts/migrate-to-qiniu.js         （交互确认）
 *    node scripts/migrate-to-qiniu.js --yes   （跳过确认，非交互）
 */
require('dotenv').config();
const qiniu = require('qiniu');
const fs = require('fs');
const path = require('path');
const db = require('../database');

const config = {
  accessKey: process.env.QINIU_ACCESS_KEY || '',
  secretKey: process.env.QINIU_SECRET_KEY || '',
  bucket: process.env.QINIU_BUCKET || 'xuanjian-top',
  domain: process.env.QINIU_DOMAIN || 'https://cdn.xuanjian.top',
  uploadsDir: path.join(__dirname, '..', 'data', 'uploads'),
};

// 需要迁移的表与列
const TARGETS = [
  ['posts', 'images'],
  ['posts', 'content'],
  ['users', 'avatar'],
  ['users', 'cover'],
  ['banners', 'image'],
  ['shop_items', 'image'],
  ['contribution_claims', 'evidence'],
];

const UPLOAD_RE = /\/uploads\/([^\s"'<>\\,)\]]+)/g;

const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
const formUploader = new qiniu.form_up.FormUploader(new qiniu.conf.Config());

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
      if (resp.statusCode === 200) resolve({ key: body.key, hash: body.hash });
      else reject(new Error(`上传失败: HTTP ${resp.statusCode}`));
    });
  });
}

/** 表列是否存在 */
async function hasColumn(table, col) {
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === col);
}

async function main() {
  if (!config.accessKey || !config.secretKey) {
    console.error('[错误] 缺少 QINIU_ACCESS_KEY / QINIU_SECRET_KEY，请检查 .env');
    process.exit(1);
  }

  // 服务运行中写库，设置等待锁超时避免 SQLITE_BUSY
  await db.run('PRAGMA busy_timeout = 10000');

  console.log('=== 七牛云图片迁移脚本 ===\n');
  console.log(`  Bucket: ${config.bucket}`);
  console.log(`  Domain: ${config.domain}`);
  console.log(`  上传目录: ${config.uploadsDir}\n`);

  // 1. 收集所有 /uploads/ 引用
  const refs = new Map(); // filename -> { count }
  const rows = [];        // [{ table, col, id, value }]
  for (const [table, col] of TARGETS) {
    if (!(await hasColumn(table, col))) continue;
    const list = await db.all(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} LIKE '%/uploads/%'`);
    for (const r of list) {
      const value = String(r.v || '');
      const matches = value.match(UPLOAD_RE) || [];
      for (const m of matches) {
        const fname = m.replace('/uploads/', '');
        refs.set(fname, (refs.get(fname) || 0) + 1);
      }
      if (matches.length) rows.push({ table, col, id: r.id, value });
    }
  }

  if (refs.size === 0) {
    console.log('没有发现 /uploads/ 引用，无需迁移。');
    db.close();
    return;
  }

  console.log(`待迁移图片文件: ${refs.size} 个，引用次数: ${[...refs.values()].reduce((a, b) => a + b, 0)} 次\n`);

  // 2. 确认
  const yes = process.argv.includes('--yes');
  if (!yes) {
    console.log('确认开始迁移？（y/n）');
    process.stdin.once('data', async (data) => {
      const answer = data.toString().trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        console.log('取消迁移。');
        db.close();
        process.exit(0);
      }
      await migrate(refs, rows);
    });
  } else {
    await migrate(refs, rows);
  }
}

async function migrate(refs, rows) {
  const stats = { total: refs.size, success: 0, skipped: 0, failed: 0 };
  const uploaded = new Set(); // 成功上传的文件名

  // 3. 逐文件上传
  console.log('开始上传图片...\n');
  for (const [fname, count] of refs) {
    const localPath = path.join(config.uploadsDir, fname);
    const remoteKey = `images/${fname}`;
    try {
      if (!fs.existsSync(localPath)) {
        console.log(`[跳过] 本地文件不存在: ${fname}（引用 ${count} 次）`);
        stats.skipped++;
        continue;
      }
      console.log(`[上传] ${fname}`);
      const result = await uploadFile(localPath, remoteKey);
      console.log(`[成功] ${config.domain}/${result.key}`);
      uploaded.add(fname);
      stats.success++;
    } catch (err) {
      console.log(`[失败] ${fname}: ${err.message}`);
      stats.failed++;
    }
  }

  // 4. 更新数据库（仅替换已成功上传的文件，失败/跳过的保留原路径）
  console.log('\n更新数据库...');
  const prefix = `${config.domain}/images/`;
  let updatedRows = 0;
  for (const { table, col, id, value } of rows) {
    const newValue = value.replace(UPLOAD_RE, (m, fname) =>
      uploaded.has(fname) ? `${prefix}${fname}` : m
    );
    if (newValue !== value) {
      await db.run(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [newValue, id]);
      updatedRows++;
    }
  }
  console.log(`数据库已更新 ${updatedRows} 行`);

  // 5. 统计
  console.log('\n=== 迁移完成 ===');
  console.log(`  图片总数: ${stats.total}`);
  console.log(`  成功: ${stats.success}`);
  console.log(`  跳过(本地缺失): ${stats.skipped}`);
  console.log(`  失败: ${stats.failed}`);
  console.log(`  数据库更新行数: ${updatedRows}`);

  db.close();
}

main().catch(err => {
  console.error('迁移出错:', err);
  db.close();
  process.exit(1);
});
