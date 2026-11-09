/** 把 PCL2 的「原版资源」下载地址指向公会镜像（只改资源/库，不动 Forge/Fabric/OptiFine 的元数据接口） */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'H:/chengxuyuanma/PCL-unzip/PCL-main';
const MIRROR = 'https://mc-cdn.xuanjian.top';
const TARGETS = [
    'Plain Craft Launcher 2/Modules/Minecraft/ModDownload.vb',
    'Plain Craft Launcher 2/Modules/Minecraft/ModMinecraft.vb',
    'Plain Craft Launcher 2/Pages/PageDownload/ModDownloadLib.vb'
];

const report = [];

for (const rel of TARGETS) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { report.push(['跳过(不存在)', rel]); continue; }
    let s = fs.readFileSync(p, 'utf8');
    const before = s;
    let n = 0;

    // 1) 资源 / 库 / maven 三类路径：只换域名，路径保持不变（镜像已按 BMCLAPI 结构组织）
    for (const sub of ['assets', 'maven', 'libraries']) {
        const from = 'https://bmclapi2.bangbang93.com/' + sub;
        const to = MIRROR + '/' + sub;
        const cnt = s.split(from).length - 1;
        if (cnt) { s = s.split(from).join(to); n += cnt; }
    }

    // 2) 版本清单：指向公会镜像（路径与 BMCLAPI 一致）
    const mfFrom = 'https://bmclapi2.bangbang93.com/mc/game/version_manifest.json';
    const mfTo = MIRROR + '/mc/game/version_manifest.json';
    const mfCnt = s.split(mfFrom).length - 1;
    if (mfCnt) { s = s.split(mfFrom).join(mfTo); n += mfCnt; }

    if (s !== before) {
        fs.writeFileSync(p, s, 'utf8');
        report.push(['已修改 ' + n + ' 处', rel]);
    } else {
        report.push(['无变更', rel]);
    }
}

// 3. 统计仍指向 BMCLAPI 的位置（这些是 Forge/Fabric/NeoForge/OptiFine 元数据，镜像未提供，保留）
const files = [];
const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.name.endsWith('.vb')) files.push(fp);
    }
};
walk(path.join(ROOT, 'Plain Craft Launcher 2'));
let remain = 0;
for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    remain += (c.split('bmclapi2.bangbang93.com').length - 1);
}

console.log('=== 改动结果 ===');
report.forEach(([a, b]) => console.log('  ' + a.padEnd(16) + b));
console.log('\n=== 仍指向 BMCLAPI 的引用：' + remain + ' 处（Forge/Fabric/NeoForge/OptiFine 元数据，镜像未提供，保留）===');
