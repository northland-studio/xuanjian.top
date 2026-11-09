/**
 * Mojang → 七牛 原版 Minecraft 文件同步
 *
 * 用法：node sync-mc-mirror.js [版本号 ...]
 *   例：node sync-mc-mirror.js 26.3 1.20.1
 *
 * 环境变量（读 /var/www/xuanjian-guild/.env）：
 *   QINIU_ACCESS_KEY / QINIU_SECRET_KEY
 *   MIRROR_BUCKET   默认 xuanjian-mc-mirror
 *   MIRROR_DOMAIN   默认 https://mc-cdn.xuanjian.top
 *   MIRROR_REGION   默认 as0（东南亚）
 *
 * 产物结构（BMCLAPI 兼容）：
 *   mc/game/version_manifest_v2.json
 *   version/<id>/json
 *   version/<id>/client
 *   version/<id>/<logConfigId>
 *   maven/<maven path>
 *   assets/indexes/<assetIndexId>.json
 *   assets/<sha1前2位>/<sha1>
 *
 * 特性：断点续传（已存在且大小一致则跳过）、失败重试、并发上传、manifest 最后上传。
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const APP = process.env.APP_DIR || '/var/www/xuanjian-guild';
require(path.join(APP, 'node_modules/dotenv')).config({ path: path.join(APP, '.env'), quiet: true });
const qiniu = require(path.join(APP, 'node_modules/qiniu'));

const BUCKET = process.env.MIRROR_BUCKET || 'xuanjian-mc-mirror';
const DOMAIN = (process.env.MIRROR_DOMAIN || 'https://mc-cdn.xuanjian.top').replace(/\/+$/, '');
const ZONE = (process.env.MIRROR_REGION || 'as0').toLowerCase();
const CACHE = process.env.MIRROR_CACHE || '/root/mc-mirror-cache';
const CONCURRENCY = Number(process.env.MIRROR_CONCURRENCY || 10);

const mac = new qiniu.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);
const cfg = new qiniu.conf.Config();
cfg.zone = qiniu.zone['Zone_' + ZONE] || qiniu.zone.Zone_as0;
const putPolicy = new qiniu.rs.PutPolicy({ scope: BUCKET });
const formUploader = new qiniu.form_up.FormUploader(cfg);
const bucketManager = new qiniu.rs.BucketManager(mac, cfg);
const putExtra = new qiniu.form_up.PutExtra();

fs.mkdirSync(CACHE, { recursive: true });

/* ---------- 基础工具 ---------- */
function httpGet(url, { redirect = 0 } = {}) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'xuanjian-mirror/1.0' }, timeout: 60000 }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirect < 5) {
                res.resume();
                return resolve(httpGet(res.headers.location, { redirect: redirect + 1 }));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('timeout', function () { this.destroy(new Error('timeout ' + url)); }).on('error', reject);
    });
}

async function fetchJson(url) {
    return JSON.parse((await httpGet(url)).toString('utf8'));
}

function objExists(key, size) {
    return new Promise((resolve) => {
        bucketManager.stat(BUCKET, key, (err, body, info) => {
            if (err || info.statusCode !== 200) return resolve(false);
            resolve(Number(body.fsize) === Number(size));
        });
    });
}

const UPLOAD_HOST = (process.env.MIRROR_UPLOAD_HOST || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** 直传加速域名（fetch multipart），未配置则回退到 SDK */
async function uploadViaHost(key, buf, mime) {
    const token = new qiniu.rs.PutPolicy({ scope: `${BUCKET}:${key}` }).uploadToken(mac);
    const fd = new FormData();
    fd.append('token', token);
    fd.append('key', key);
    fd.append('file', new Blob([buf], { type: mime || 'application/octet-stream' }), 'blob.bin');
    const res = await fetch('https://' + UPLOAD_HOST + '/', { method: 'POST', body: fd });
    if (res.status !== 200) throw new Error('upload ' + res.status + ' ' + (await res.text()).slice(0, 150));
    return true;
}

function uploadBuffer(key, buf, mime) {
    if (UPLOAD_HOST) return uploadViaHost(key, buf, mime);
    return new Promise((resolve, reject) => {
        const token = new qiniu.rs.PutPolicy({ scope: `${BUCKET}:${key}` }).uploadToken(mac);
        const extra = new qiniu.form_up.PutExtra();
        if (mime) extra.mimeType = mime;
        formUploader.put(token, key, buf, extra, (err, body, info) => {
            if (err) return reject(err);
            if (info.statusCode === 200) return resolve(body);
            reject(new Error('upload ' + info.statusCode + ' ' + JSON.stringify(body).slice(0, 200)));
        });
    });
}

let stats = { skip: 0, upload: 0, fail: 0, bytes: 0 };
const failed = [];

/** 下载 + 上传单文件（带重试与跳过） */
async function syncFile(key, url, { mime, size } = {}) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            if (size && (await objExists(key, size))) { stats.skip++; return; }
            const buf = await httpGet(url);
            await uploadBuffer(key, buf, mime);
            stats.upload++;
            stats.bytes += buf.length;
            if (stats.upload % 20 === 0) console.log('  … 已上传 ' + stats.upload + '，跳过 ' + stats.skip + '，失败 ' + stats.fail);
            return;
        } catch (e) {
            if (attempt === 5) { stats.fail++; failed.push({ key, url, error: e.message }); console.error('  ✗ ' + key + ' : ' + e.message); }
            else await new Promise((r) => setTimeout(r, 500 * attempt));
        }
    }
}

/** 并发池 */
async function runPool(tasks, concurrency = CONCURRENCY) {
    let i = 0;
    const workers = Array.from({ length: concurrency }, async () => {
        while (i < tasks.length) {
            const t = tasks[i++];
            await t();
        }
    });
    await Promise.all(workers);
}

/* ---------- 主流程 ---------- */
async function syncVersion(id) {
    console.log('\n===== 版本 ' + id + ' =====');
    const manifest = JSON.parse((await httpGet('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).toString('utf8'));
    const entry = manifest.versions.find((v) => v.id === id);
    if (!entry) throw new Error('Mojang 清单中找不到版本 ' + id);
    console.log('  version json: ' + entry.url);

    const vj = await fetchJson(entry.url);
    const tasks = [];

    // 1. client jar
    if (vj.downloads && vj.downloads.client) {
        const c = vj.downloads.client;
        vj.downloads.client.url = `${DOMAIN}/version/${id}/client`;
        tasks.push(() => syncFile(`version/${id}/client`, c.url_original || c.url.replace(DOMAIN, 'https://piston-data.mojang.com'), { size: c.size, mime: 'application/java-archive' }));
    }
    // 注意：上面先把 url 改写了，取原地址要提前保存
    return { vj, entry, tasks };
}

async function main() {
    const versions = process.argv.slice(2);
    if (!versions.length) {
        console.error('用法：node sync-mc-mirror.js <版本号> [版本号...]');
        process.exit(2);
    }
    console.log('bucket=' + BUCKET + '  domain=' + DOMAIN + '  concurrency=' + CONCURRENCY);

    const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const mirrored = [];

    for (const id of versions) {
        const entry = manifest.versions.find((v) => v.id === id);
        if (!entry) throw new Error('找不到版本 ' + id);
        console.log('\n===== ' + id + ' =====');
        const vj = await fetchJson(entry.url);

        const tasks = [];

        // client jar
        if (vj.downloads && vj.downloads.client) {
            const src = vj.downloads.client.url;
            const size = vj.downloads.client.size;
            tasks.push(() => syncFile(`version/${id}/client`, src, { size, mime: 'application/java-archive' }));
            vj.downloads.client.url = `${DOMAIN}/version/${id}/client`;
        }
        // server jar（可选，有就同步）
        if (vj.downloads && vj.downloads.server) {
            const src = vj.downloads.server.url;
            const size = vj.downloads.server.size;
            tasks.push(() => syncFile(`version/${id}/server`, src, { size, mime: 'application/java-archive' }));
            vj.downloads.server.url = `${DOMAIN}/version/${id}/server`;
        }

        // libraries
        for (const lib of vj.libraries || []) {
            const d = lib.downloads || {};
            const items = [];
            if (d.artifact && d.artifact.path && d.artifact.url) items.push(d.artifact);
            for (const c of Object.values(d.classifiers || {})) if (c.path && c.url) items.push(c);
            for (const it of items) {
                const src = it.url;
                const size = it.size;
                const key = `maven/${it.path}`;
                tasks.push(() => syncFile(key, src, { size, mime: 'application/java-archive' }));
                it.url = `${DOMAIN}/${key}`;
            }
        }

        // asset index
        const ai = vj.assetIndex;
        let assetIndexJson = null;
        if (ai && ai.url) {
            assetIndexJson = await fetchJson(ai.url);
            const idxKey = `assets/indexes/${ai.id}.json`;
            const idxBuf = Buffer.from(JSON.stringify(assetIndexJson));
            tasks.push(async () => {
                try { await uploadBuffer(idxKey, idxBuf, 'application/json'); stats.upload++; stats.bytes += idxBuf.length; }
                catch (e) { stats.fail++; failed.push({ key: idxKey, error: e.message }); }
            });
            ai.url = `${DOMAIN}/${idxKey}`;
        }

        // logging config
        const logFile = vj.logging && vj.logging.client && vj.logging.client.file;
        if (logFile && logFile.url) {
            const src = logFile.url;
            const key = `version/${id}/${logFile.id}`;
            tasks.push(() => syncFile(key, src, { size: logFile.size }));
            logFile.url = `${DOMAIN}/${key}`;
        }

        // 先传本版本资源
        await runPool(tasks);
        console.log('  资源: 上传 ' + stats.upload + ' / 跳过 ' + stats.skip + ' / 失败 ' + stats.fail);

        // 版本 json（改写后）
        const vjKey = `version/${id}/json`;
        const vjBuf = Buffer.from(JSON.stringify(vj, null, 2));
        await uploadBuffer(vjKey, vjBuf, 'application/json');
        console.log('  ✓ ' + vjKey);

        // assets 对象
        if (assetIndexJson && assetIndexJson.objects) {
            const hashes = [...new Set(Object.values(assetIndexJson.objects).map((o) => o.hash))];
            console.log('  assets 对象: ' + hashes.length + ' 个（开始并发上传）');
            const assetTasks = hashes.map((h) => async () => {
                const key = `assets/${h.slice(0, 2)}/${h}`;
                const url = `https://resources.download.minecraft.net/${h.slice(0, 2)}/${h}`;
                await syncFile(key, url, {});
            });
            await runPool(assetTasks);
            console.log('  资源+assets: 上传 ' + stats.upload + ' / 跳过 ' + stats.skip + ' / 失败 ' + stats.fail);
        }

        mirrored.push({
            id,
            type: entry.type,
            releaseTime: entry.releaseTime,
            url: `${DOMAIN}/version/${id}/json`
        });
    }

    // 自建版本清单（只列已镜像版本）
    const outManifest = {
        latest: { release: mirrored[0].id, snapshot: mirrored[0].id },
        versions: mirrored
    };
    await uploadBuffer('mc/game/version_manifest_v2.json', Buffer.from(JSON.stringify(outManifest, null, 2)), 'application/json');
    console.log('\n✓ mc/game/version_manifest_v2.json（' + mirrored.length + ' 个版本）');

    console.log('\n===== 完成 =====');
    console.log('  上传 ' + stats.upload + ' 个文件，跳过 ' + stats.skip + ' 个，失败 ' + stats.fail + ' 个');
    console.log('  总流量 ' + (stats.bytes / 1024 / 1024).toFixed(1) + ' MB');
    if (failed.length) {
        fs.writeFileSync('/root/mc-mirror-failed.json', JSON.stringify(failed, null, 2));
        console.log('  失败清单已写入 /root/mc-mirror-failed.json（重跑即可续传）');
    }
    process.exit(stats.fail ? 1 : 0);
}

main().catch((e) => { console.error('同步失败：' + (e && e.stack ? e.stack : e)); process.exit(1); });
