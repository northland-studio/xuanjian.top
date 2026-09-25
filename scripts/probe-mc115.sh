#!/bin/bash
cd /var/www/xuanjian-guild
cat > /tmp/mcprobe.js <<'JS'
const mc = require('/var/www/xuanjian-guild/lib/mc-status');
(async () => {
    const t0 = Date.now();
    const s = await mc.pingStatus('115.190.153.44', 25565, 6000);
    console.log('115 状态查询耗时', Date.now() - t0, 'ms');
    console.log(JSON.stringify(s, null, 2));
    const all = mc.servers();
    console.log('服务器清单:', JSON.stringify(all));
    process.exit(0);
})();
JS
node /tmp/mcprobe.js
