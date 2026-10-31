#!/bin/bash
# 部署曲线数据修复并验证
set -u
cd /var/www/xuanjian-guild || exit 1
cp /root/xindex-lib.js lib/express-index.js
node --check lib/express-index.js && echo "语法 OK"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6

node - <<'EOF' 2>&1 | grep -v dotenv
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const db = require('/var/www/xuanjian-guild/database');
const ei = require('/var/www/xuanjian-guild/lib/express-index');
(async () => {
    const st = await db.get('SELECT id, name, current_price FROM stocks WHERE id = 15');
    await db.run('INSERT INTO stock_prices (stock_id, price, volume, recorded_at) VALUES (?, ?, 0, CURRENT_TIMESTAMP)', [st.id, st.current_price]);
    const h = await ei.history(15, 40, '1d');
    console.log('  玄剑重工现价: ' + st.current_price);
    console.log('  曲线点数: ' + h.points.length);
    h.points.slice(-6).forEach((p) => console.log('   ' + p.label + ' → ' + p.price));
    process.exit(0);
})();
EOF
