/**
 * 七牛上传测速：上传 N 次固定大小随机缓冲，输出 MB/s
 * 用法：node speedtest-upload.js [大小MB] [次数]
 */
const path = require('node:path');
const crypto = require('node:crypto');

const qiniuPath = process.env.QINIU_MODULE || (process.env.APP_DIR ? path.join(process.env.APP_DIR, 'node_modules/qiniu') : 'qiniu');
const qiniu = require(qiniuPath);

const SIZE_MB = Number(process.argv[2] || 10);
const TIMES = Number(process.argv[3] || 3);
const BUCKET = process.env.MIRROR_BUCKET || 'xuanjian-mc-mirror';
const ZONE = (process.env.MIRROR_REGION || 'as0').toLowerCase();

const mac = new qiniu.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);
const cfg = new qiniu.conf.Config();
cfg.zone = qiniu.zone['Zone_' + ZONE] || qiniu.zone.Zone_as0;
const uploader = new qiniu.form_up.FormUploader(cfg);

function put(key, buf) {
    return new Promise((resolve, reject) => {
        const token = new qiniu.rs.PutPolicy({ scope: `${BUCKET}:${key}` }).uploadToken(mac);
        const started = Date.now();
        uploader.put(token, key, buf, new qiniu.form_up.PutExtra(), (err, body, info) => {
            if (err) return reject(err);
            if (info.statusCode !== 200) return reject(new Error('HTTP ' + info.statusCode + ' ' + JSON.stringify(body).slice(0, 150)));
            resolve({ ms: Date.now() - started, host: (info && info.headers && info.headers.server) || '' });
        });
    });
}

(async () => {
    const buf = crypto.randomBytes(SIZE_MB * 1024 * 1024);
    const results = [];
    console.log(`  目标: ${BUCKET} (${ZONE})  单次 ${SIZE_MB}MB × ${TIMES} 次`);
    for (let i = 1; i <= TIMES; i++) {
        const key = `speedtest/${Date.now()}-${i}-${crypto.randomBytes(4).toString('hex')}.bin`;
        try {
            const r = await put(key, buf);
            const mbps = (SIZE_MB / (r.ms / 1000));
            results.push(mbps);
            console.log(`  #${i}  ${r.ms}ms  ${mbps.toFixed(2)} MB/s`);
        } catch (e) {
            console.log(`  #${i}  失败: ${e.message}`);
        }
    }
    if (results.length) {
        const avg = results.reduce((s, v) => s + v, 0) / results.length;
        const best = Math.max(...results);
        console.log(`  --- 平均 ${avg.toFixed(2)} MB/s ｜ 最快 ${best.toFixed(2)} MB/s ---`);
    }
    process.exit(0);
})();
