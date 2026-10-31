#!/bin/bash
# 部署 notice 多账号改造并验证向后兼容
set -u
APP=/opt/xuanjian-notice
cd "$APP"
TS=$(date +%Y%m%d-%H%M%S)

echo "=== 1. 备份 ==="
tar -czf "/root/notice-backup-$TS.tgz" --exclude=data src standalone.mjs webui 2>/dev/null
echo "  /root/notice-backup-$TS.tgz"

echo
echo "=== 2. 应用文件 ==="
cp /root/notice-src-new/src/routes.mjs src/routes.mjs
cp /root/notice-src-new/standalone.mjs standalone.mjs
cp /root/notice-src-new/webui/index.html webui/index.html
node --check standalone.mjs && echo "  standalone 语法 OK"
node --check src/routes.mjs && echo "  routes 语法 OK"

echo
echo "=== 3. .env 追加多账号配置（单账号，与原配置一致）==="
if ! grep -q '^NOTICE_ACCOUNTS=' .env; then
  TOKEN=$(grep '^ONEBOT_ACCESS_TOKEN=' .env | cut -d= -f2-)
  PORT=$(grep '^ONEBOT_WS_PORT=' .env | cut -d= -f2-)
  printf '\n# 多账号（JSON 数组）：id / name / port / token / enabled\nNOTICE_ACCOUNTS=[{"id":"xjj","name":"玄剑姬","port":%s,"token":"%s","enabled":true}]\n' "${PORT:-13003}" "$TOKEN" >> .env
  echo "  已追加（单账号 xjj）"
else
  echo "  已存在，跳过"
fi
grep '^NOTICE_ACCOUNTS=' .env | sed -E 's/"token":"[^"]*"/"token":"****"/'

echo
echo "=== 4. 重启 ==="
pm2 restart xuanjian-notice --update-env >/dev/null 2>&1
sleep 8
pm2 list 2>/dev/null | grep -E 'xuanjian-notice' | head -2

echo
echo "=== 5. 启动日志（账号清单）==="
pm2 logs xuanjian-notice --lines 25 --nostream 2>/dev/null | grep -aE 'accounts|账号|OneBot|路由数' | tail -6

echo
echo "=== 6. 健康与接口 ==="
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:3910/
echo -n "  /health: "; curl -s --max-time 10 http://127.0.0.1:3910/api/health | head -c 200; echo
echo -n "  /accounts(未登录应 401): "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:3910/api/accounts
echo -n "  /status(未登录应 401): "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:3910/api/status
echo -n "  前端含切换器: "; curl -s --max-time 10 http://127.0.0.1:3910/ | grep -c 'account-switcher'
