/** 查找商城公户 / 系统账号 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

console.log('=== 1. 代码里关于公户 / 系统账号的线索 ===');
const patterns = [/escrow/i, /treasury/i, /system_user/i, /SYSTEM_USER/i, /market_account/i];
const files = [];
const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'data', 'frontend', 'uploads'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|sql)$/.test(e.name)) files.push(p);
    }
};
walk(ROOT);
const hits = new Map();
for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const re of patterns) {
        if (re.test(s)) {
            const m = s.match(new RegExp('^.*' + re.source + '.*$', 'gm')) || [];
            console.log('  ' + path.relative(ROOT, f) + ' -> ' + (m[0] || '').trim().slice(0, 110));
            break;
        }
    }
}

console.log('\n=== 2. 生产库里的系统账号候选（需连服务器查，这里只给 SQL）===');
console.log(`
  SELECT id, username, nickname, level, contribution FROM users
   WHERE username LIKE '%market%' OR username LIKE '%escrow%' OR nickname LIKE '%公%'
      OR username LIKE '%system%' OR level < 0;
`);
