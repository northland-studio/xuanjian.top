/**
 * 应用更新 - CDN 代理路由
 *
 * 为桌面版（Electron）与 Android 版（Capacitor）提供更新源。
 * 七牛空间 xuanjian-top（公开，域名 cdn.xuanjian.top）下的 releases/ 目录存放：
 *   - releases/latest.yml           Electron 更新清单（electron-builder 生成）
 *   - releases/release-notes.json   Electron 更新公告
 *   - releases/android/latest.json  Android 更新元数据
 *   - releases/android/*.apk        Android 安装包
 *   - releases/*.exe / *.blockmap   Electron 安装包
 *
 * GET /api/updates/latest.yml         返回改写后的 latest.yml（URL 指向 CDN 完整地址）
 * GET /api/updates/files/:key         302 重定向到 CDN 下载
 * GET /api/updates/release-notes.json 返回更新公告
 * GET /api/updates/android/latest.json 返回 Android 更新元数据
 */

const express = require('express');
const https = require('https');
const logger = require('../lib/logger');
const router = express.Router();

const CDN_BASE = (process.env.QINIU_CDN_DOMAIN || 'https://cdn.xuanjian.top').replace(/\/$/, '');

// HTTPS 获取远程内容
function cdnGet(key) {
  return new Promise((resolve, reject) => {
    https.get(`${CDN_BASE}/${key}`, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return cdnGet(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject).setTimeout(10000, () => reject(new Error('timeout')));
  });
}

// Electron 更新清单：把文件 URL 改写为 CDN 完整地址
router.get('/latest.yml', async (_req, res) => {
  try {
    const body = (await cdnGet('releases/latest.yml')).toString('utf-8');
    const rewritten = body.replace(
      /^(\s*- url:\s*)(.+)$/gm,
      (m, prefix, fileName) => `${prefix}${CDN_BASE}/releases/${encodeURIComponent(fileName.trim())}`
    );
    res.set('Content-Type', 'text/yaml; charset=utf-8');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(rewritten);
  } catch (e) {
    logger.error('latest.yml 读取失败', { error: e.message });
    res.status(404).json({ error: 'update source unavailable' });
  }
});

// 更新公告
router.get('/release-notes.json', async (_req, res) => {
  try {
    const body = await cdnGet('releases/release-notes.json');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(body);
  } catch (e) {
    logger.error('release-notes.json 读取失败', { error: e.message });
    res.status(404).json({ error: 'release notes not found' });
  }
});

// Android 更新元数据
router.get('/android/latest.json', async (_req, res) => {
  try {
    const body = await cdnGet('releases/android/latest.json');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(body);
  } catch (e) {
    logger.error('android/latest.json 读取失败', { error: e.message });
    res.status(404).json({ error: 'android update meta not found' });
  }
});

// 更新文件下载（302 到 CDN），支持多级路径如 android/xuanjian-guild-1.0.0.apk
router.get('/files/*', (req, res) => {
  try {
    const key = `releases/${decodeURIComponent(req.params[0] || '')}`;
    if (!key.endsWith('/')) {
      res.redirect(302, `${CDN_BASE}/${key}`);
      return;
    }
    res.status(404).json({ error: 'not found' });
  } catch (e) {
    logger.error('更新文件签名失败', { error: e.message });
    res.status(500).send('redirect error');
  }
});

module.exports = router;
