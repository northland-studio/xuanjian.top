#!/bin/bash
# 部署护栏旁路开关并验证
set -u
APP=/opt/xuanjian-notice
cd "$APP"
TS=$(date +%Y%m%d-%H%M%S)

echo "=== 1. 备份 ==="
tar -czf "/root/notice-guard-backup-$TS.tgz" src/guards.mjs src/routes.mjs webui/index.html 2>/dev/null
echo "  /root/notice-guard-backup-$TS.tgz"

echo
echo "=== 2. 应用 ==="
cp /root/notice-guard/guards.mjs src/guards.mjs
cp /root/notice-guard/routes.mjs src/routes.mjs
cp /root/notice-guard/index.html webui/index.html
node --check src/guards.mjs && node --check src/routes.mjs && echo "  语法 OK"

echo
echo "=== 3. 重启 ==="
pm2 restart xuanjian-notice --update-env >/dev/null 2>&1
sleep 8
pm2 list 2>/dev/null | grep xuanjian-notice | head -1

echo
echo "=== 4. 护栏状态（默认应开启=未旁路）==="
cat > /tmp/test-bypass.sh <<'EOS'
P=/plugin/napcat-plugin-xuanjian-broadcast/api
B=http://127.0.0.1:3910
echo -n "  /guards 未登录: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "$B$P/guards"
echo -n "  /guards/bypass 未登录: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 -X POST "$B$P/guards/bypass" -H 'Content-Type: application/json' -d '{"on":true}'
echo -n "  首页: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "$B/"
echo -n "  前端含护栏开关: "
curl -s --max-time 10 "$B/" | grep -c 'guards-switch'
echo -n "  data/bypass.json: "
cat /opt/xuanjian-notice/data/bypass.json 2>/dev/null || echo "（尚未创建，首次切换时生成）"
EOS
bash /tmp/test-bypass.sh

echo
echo "=== 5. 逻辑验证：直接用 node 检查旁路是否放行 ==="
node -e "
require('dotenv').config();
const path=require('path');
const g=require('./src/guards.mjs');
const cfg=require('./src/config.mjs');
(async()=>{
  g.initGuards({ dataDir: path.join(process.cwd(),'data'), tripHandler: null });
  const before = g.bypassState();
  console.log('  初始 bypass: ' + JSON.stringify(before));
  console.log('  windowState.open: ' + JSON.stringify(g.windowState().open));
  console.log('  checkQuota: ' + (g.checkQuota('temp', 50).ok ? 'ok' : 'blocked'));
  const st = g.setBypassState(true, 'deploy-test', '部署自检');
  console.log('  开启后 bypass: ' + JSON.stringify(st));
  console.log('  windowState: ' + JSON.stringify({open:g.windowState().open, bypassed:g.windowState().bypassed}));
  console.log('  checkQuota(50人): ' + JSON.stringify(g.checkQuota('temp', 50)));
  console.log('  breakerBlock: ' + JSON.stringify(g.breakerBlock()));
  g.setBypassState(false, 'deploy-test', '自检结束复原');
  console.log('  复原后 bypass: ' + JSON.stringify(g.bypassState()));
  process.exit(0);
})();" 2>&1 | grep -v dotenv | head -14
