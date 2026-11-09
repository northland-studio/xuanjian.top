/**
 * 七牛上传测速（可指定加速域名，绕开 SDK 的 host 选择）
 * 用法：node speedtest-accel.js <上传域名> [MB] [次数]
 * 环境：QINIU_ACCESS_KEY / QINIU_SECRET_KEY / MIRROR_BUCKET
 */
const crypto = require('node:crypto');
const path = require('node:path');

const qiniu = require(process.env.APP_DIR ? path.join(process.env.APP_DIR, 'node_modules/qiniu') : 'qiniu');
const HOST = process.argv[2] || 'xuanjian-mc-mirror.kodo-accelerate.ap-southeast-1.qiniucs.com';
const SIZE_MB = Number(process.argv[3] || 10);
const TIMES = Number(process.argv[4] || 3);
const BUCKET = process.env.MIRROR_BUCKET || 'xuanjian-mc-mirror';
const URL = 'https://' + HOST.replace(/^https?:\/\//, '') + '/';

const mac = new qiniu.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);

async function put(buf, key) {
    const token = new qiniu.rs.PutPolicy({ scope: `${BUCKET}:${key}` }).uploadToken(mac);
    const fd = new FormData();
    fd.append('token', token);
    fd.append('key', key);
    fd.append('file', new Blob([buf], { type: 'application/octet-stream' }), 'blob.bin');
    const t = Date.now();
    const res = await fetch(URL, { method: 'POST', body: fd });
    const ms = Date.now() - t;
    const body = await res.text();
    if (res.status !== 200) throw new Error('HTTP ' + res.status + ' ' + body.slice(0, 120));
    return ms;
}

(async () => {
    const buf = crypto.randomBytes(SIZE_MB * 1024 * 1024);
    console.log(`  上传域: ${HOST}`);
    console.log(`  单次 ${SIZE_MB}MB × ${TIMES} 次`);
    const arr = [];
    for (let i = 1; i <= TIMES; i++) {
        const key = `speedtest/accel-${Date.now()}-${i}.bin`;
        try {
            const ms = await put(buf, key);
            const v = SIZE_MB / (ms / 1000);
            arr.push(v);
            console.log(`  #${i}  ${ms}ms  ${v.toFixed(2)} MB/s`);
        } catch (e) {
            console.log(`  #${i}  失败: ${e.message}`);
        }
    }
    if (arr.length) {
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        console.log(`  --- 平均 ${avg.toFixed(2)} MB/s ｜ 最快 ${Math.max(...arr).toFixed(2)} MB/s ---`);
    }
    process.exit(0);
})();
