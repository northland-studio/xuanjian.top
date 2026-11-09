#!/bin/bash
# 校验 26.2 同步结果
set -u
cd /var/www/xuanjian-guild || exit 1

cat > /tmp/verify262.cjs <<'EOF'
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const https = require('https');
const q = require('/var/www/xuanjian-guild/node_modules/qiniu');
const mac = new q.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY);
const c = new q.conf.Config();
c.zone = q.zone.Zone_as0;
const bm = new q.rs.BucketManager(mac, c);
const BUCKET = 'xuanjian-mc-mirror';
const DOMAIN = 'https://mc-cdn.xuanjian.top';

const list = (prefix, limit = 1000) => new Promise((res) => {
  bm.listPrefix(BUCKET, { prefix, limit }, (e, b, i) => res(i && i.statusCode === 200 ? (b.items || []) : []));
});
const stat = (key) => new Promise((res) => {
  bm.stat(BUCKET, key, (e, b, i) => res(i && i.statusCode === 200 ? b : null));
});
const getText = (url) => new Promise((res) => {
  https.get(url, { timeout: 20000 }, (r) => {
    if (r.statusCode !== 200) { r.resume(); return res({ status: r.statusCode }); }
    let d = '';
    r.on('data', (x) => (d += x));
    r.on('end', () => res({ status: 200, body: d }));
  }).on('error', (e) => res({ status: 0, error: e.message }));
});

(async () => {
  for (const id of ['26.2']) {
    console.log('===== ' + id + ' =====');
    const vfiles = await list('version/' + id + '/');
    console.log('  version/' + id + '/ 对象: ' + vfiles.length);
    for (const f of vfiles.slice(0, 6)) console.log('    ' + f.key + '  ' + (f.fsize / 1024 / 1024).toFixed(2) + 'MB');

    const idx = await list('assets/indexes/');
    console.log('  assets/indexes/: ' + idx.length + ' 个 -> ' + idx.map((x) => x.key.split('/').pop()).join(', ').slice(0, 120));

    const assets = await list('assets/', 1000);
    console.log('  assets/ 抽样: ' + assets.length + ' 个（单页上限 1000）');

    const maven = await list('maven/', 1000);
    console.log('  maven/: ' + maven.length + ' 个（单页上限 1000）');

    const vj = await stat('version/' + id + '/json');
    console.log('  version/' + id + '/json: ' + (vj ? '存在 ' + vj.fsize + 'B' : '缺失'));
    const cl = await stat('version/' + id + '/client');
    console.log('  version/' + id + '/client: ' + (cl ? '存在 ' + (cl.fsize / 1024 / 1024).toFixed(2) + 'MB' : '缺失'));
    const mf = await stat('mc/game/version_manifest_v2.json');
    console.log('  mc/game/version_manifest_v2.json: ' + (mf ? '存在 ' + mf.fsize + 'B' : '缺失（还没写，最后一个阶段的产物）'));

    // 尝试通过 CDN 读取（若已绑定域名且公开）
    console.log('  --- 尝试经 CDN 读取 ---');
    const r1 = await getText(DOMAIN + '/version/' + id + '/json');
    if (r1.status === 200) {
      const j = JSON.parse(r1.body);
      const urls = [
        j.downloads && j.downloads.client && j.downloads.client.url,
        j.assetIndex && j.assetIndex.url,
        j.libraries && j.libraries[0] && j.libraries[0].downloads && j.libraries[0].downloads.artifact && j.libraries[0].downloads.artifact.url
      ].filter(Boolean);
      console.log('  版本 JSON 可读 ✓  地址样例:');
      urls.slice(0, 3).forEach((u) => console.log('    ' + u));
      console.log('  是否已指向 mc-cdn: ' + urls.every((u) => u.includes('mc-cdn.xuanjian.top')));
    } else {
      console.log('  版本 JSON 经 CDN 读取失败（HTTP ' + r1.status + '）——域名可能还没绑定或空间非公开');
    }
  }
  process.exit(0);
})();
EOF
node /tmp/verify262.cjs 2>&1 | grep -v dotenv
