/**
 * 阶段 6：为每个条目取一张「主图」，下载 → sha1 去重 → 上传七牛 → 写清单
 *
 * 用法：
 *   node scripts/mcwiki/06-images.js                 # 全量（已上传过的按 sha1 跳过）
 *   node scripts/mcwiki/06-images.js --only=红石比较器,活塞
 *   node scripts/mcwiki/06-images.js --dry-run       # 只探测要传哪些，不下载不上传
 *   node scripts/mcwiki/06-images.js --limit=20
 *
 * 产物：data/mcwiki/images.json
 *   { items: { <key>: { title, alt, sourceUrl, file, sha1, key, cdn, bytes } } }
 *
 * 选图策略：用 MediaWiki 的 pageimages（= 条目信息框主图），取 640px 缩略图。
 *   教程类页面（Tutorial:）多数没有信息框，探测不到主图就跳过——不硬凑图。
 * 幂等：以「原图内容 sha1」为键，同一张图跨页面只传一次；清单里已有的直接复用。
 * 授权：图源为 Minecraft Wiki（CC BY-NC-SA 3.0），发布时会连图带出处一起标注。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
// lib/qiniu.js 在 require 时固化 process.env，所以先加载 .env
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

/** .env 兜底：QINIU_ACCESS_KEY 可能被上一行注释吞掉（缺换行） */
(function recoverQiniuEnv() {
  const missing = ['QINIU_ACCESS_KEY'].filter((k) => !process.env[k]);
  if (!missing.length) return;
  let raw = '';
  try { raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch (e) { return; }
  for (const k of missing) {
    const m = new RegExp('(?:^|[^A-Za-z0-9_])' + k + '\\s*=\\s*([^\\s#]+)').exec(raw);
    if (m) { process.env[k] = m[1]; console.warn(`⚠ .env 的 ${k} 被上一行注释吞掉，已宽松恢复`); }
  }
})();

const qiniu = require(path.join(ROOT, 'lib', 'qiniu'));
const sharp = require('sharp');
const { finalTitle } = require('./titles');

const API = 'https://zh.minecraft.wiki/api.php';
const UA = 'xuanjian-wiki-importer/0.1 (+https://xuanjian.top; admin@xuanjian.top)';
const DATA = path.join(ROOT, 'data', 'mcwiki');
const MANIFEST = path.join(DATA, 'images.json');
const KEY_PREFIX = 'wiki/mcwiki/';
const THUMB_SIZE = 640;
const MAX_BYTES = 2.5 * 1024 * 1024;
const MIN_WIDTH = 96;               // 主图最小宽度：低于此值多为 16×16 方块贴图
const OK_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const BATCH = 20;

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').slice(8)) || 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

async function api(params, tries = 4) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { lastErr = e; await sleep(800 * (i + 1)); }
  }
  throw new Error(lastErr && lastErr.message);
}

/** 批量探测主图 */
async function probeImages(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    const data = await api({ action: 'query', prop: 'pageimages', piprop: 'thumbnail|original', pithumbsize: String(THUMB_SIZE), titles: batch.join('|'), redirects: '1' });
    const map = new Map();
    for (const r of data.query?.redirects || []) map.set(r.to, r.from);
    for (const p of data.query?.pages || []) {
      const src = p.thumbnail?.source || p.original?.source || null;
      const title = map.get(p.title) || p.title;
      out[title] = src ? { src, pageTitle: p.title } : null;
    }
    await sleep(300);
  }
  return out;
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://zh.minecraft.wiki/' } });
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function uploadBuffer(key, buffer) {
  const token = qiniu.generateUploadToken(key, Math.max(5 * 1024 * 1024, buffer.length + 512 * 1024));
  const form = new FormData();
  form.append('token', token);
  form.append('key', key);
  form.append('file', new Blob([buffer]), path.basename(key));
  const res = await fetch(qiniu.QINIU_UPLOAD_URL, { method: 'POST', body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`七牛上传失败 HTTP ${res.status}：${text.slice(0, 200)}`);
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* 部分区域返回纯文本 */ }
  if (data && data.error) throw new Error('七牛上传失败：' + data.error);
  return data || { key };
}

const domainUrl = (key) => String(qiniu.QINIU_DOMAIN || '').replace(/\/+$/, '') + '/' + key;

async function main() {
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'prepared', '_index.json'), 'utf8'));
  let pages = index.pages.filter((p) => !p.thin);
  if (ONLY.length) pages = pages.filter((p) => ONLY.includes(p.key));
  if (LIMIT) pages = pages.slice(0, LIMIT);

  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { items: {} };
  manifest.items = manifest.items || {};
  const bySha = new Set(Object.values(manifest.items).map((v) => v.sha1).filter(Boolean));

  console.log(`待探测主图 ${pages.length} 页${DRY ? '（DRY-RUN）' : ''}`);
  const titles = pages.map((p) => p.sourceTitle || p.title);
  const probed = await probeImages(titles);

  let found = 0;
  let uploaded = 0;
  let reused = 0;
  let skipped = 0;
  let bytes = 0;

  for (const [i, p] of pages.entries()) {
    const hit = probed[p.sourceTitle] || probed[p.title];
    if (!hit || !hit.src) { skipped++; continue; }
    found++;
    const key = p.key;
    const url = hit.src;
    const ext = (url.split('?')[0].match(/\.([a-zA-Z0-9]+)$/) || [])[1]?.toLowerCase();
    const label = finalTitle(p.sourceTitle || p.title);

    if (!ext || !OK_EXT.includes(ext)) { console.log(`· ${key}：扩展名不支持（${ext}），跳过`); skipped++; continue; }
    if (DRY) {
      console.log(`· ${key} → ${url.split('/').pop()}（${ext}）`);
      manifest.items[key] = { title: label, alt: `${label}的外观`, sourceUrl: url, file: url.split('/').pop(), sha1: null, key: null, cdn: null, bytes: null };
      continue;
    }

    try {
      const buf = await download(url);
      if (buf.length > MAX_BYTES) { console.log(`· ${key}：图片 ${(buf.length / 1024 / 1024).toFixed(1)}MB 超过上限，跳过`); delete manifest.items[key]; skipped++; continue; }
      // 尺寸过滤：不少方块页的「信息框主图」其实是 16×16 贴图（1KB 级），
      // 直接放进正文会是一粒小点。PNG 压像素画很狠，所以只能看分辨率不能看体积。
      let dim = { width: 0, height: 0 };
      try { const m = await sharp(buf).metadata(); dim = { width: m.width || 0, height: m.height || 0 }; } catch (e) { /* 动图等按原样处理 */ }
      if (dim.width && dim.width < MIN_WIDTH) {
        console.log(`· ${key}：主图只有 ${dim.width}×${dim.height}（贴图），跳过`);
        delete manifest.items[key];
        skipped++;
        continue;
      }
      const hash = sha1(buf);
      const qkey = KEY_PREFIX + hash.slice(0, 16) + '.' + ext;
      const cdn = domainUrl(qkey);
      if (bySha.has(hash) || manifest.items[key]?.sha1 === hash) {
        reused++;
      } else {
        await uploadBuffer(qkey, buf);
        bySha.add(hash);
        uploaded++;
        bytes += buf.length;
      }
      manifest.items[key] = { title: label, alt: `${label}的外观`, sourceUrl: url, file: url.split('/').pop(), sha1: hash, key: qkey, cdn, bytes: buf.length };
      console.log(`[${i + 1}/${pages.length}] ${key.padEnd(24)} ${uploaded > 0 ? '' : ''}${(buf.length / 1024).toFixed(0)}KB → ${cdn}`);
      await sleep(250);
    } catch (e) {
      console.log(`✗ ${key}：${e.message}`);
      skipped++;
    }
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.source = 'https://zh.minecraft.wiki/';
  manifest.license = 'CC BY-NC-SA 3.0';
  if (!DRY) fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1), 'utf8');
  console.log(`\n探测到主图 ${found} 页 / 跳过 ${skipped} 页；新上传 ${uploaded} 张（${(bytes / 1024 / 1024).toFixed(2)}MB）、复用 ${reused} 张`);
  console.log(`清单：data/mcwiki/images.json（共 ${Object.keys(manifest.items).length} 条）`);
}

main().catch((e) => { console.error('取图失败：', e.message); process.exit(1); });
