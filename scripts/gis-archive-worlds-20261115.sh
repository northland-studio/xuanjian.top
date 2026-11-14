#!/bin/bash
# 归档两个 GIS 世界（站方决定：yl-main 与 樱梨-main 都 ARCHIVED、is_current=0，不删任何数据）
# 走管理员接口（POST/PUT /api/gis/admin/worlds/:id），服务端会自动写 gis_audit。
set -u
cd /var/www/xuanjian-guild || exit 1
B=https://xuanjian.top

echo "== 归档前 gis_worlds =="
sqlite3 data/guild.db "SELECT id,world_key,server_key,status,is_current FROM gis_worlds ORDER BY id;"

ADMIN_ID=$(sqlite3 data/guild.db "SELECT id FROM users WHERE level>=2 ORDER BY id LIMIT 1;")
echo "admin user id: $ADMIN_ID"
TOKEN=$(node -e "require('dotenv').config();const jwt=require('jsonwebtoken');console.log(jwt.sign({userId:Number(process.argv[1]),username:'gis-ops',level:2},process.env.JWT_SECRET,{expiresIn:'15m'}))" "$ADMIN_ID")
if [ -z "$TOKEN" ]; then echo "!! token mint failed"; exit 1; fi

for W in 1 2; do
  code=$(curl -s -o /tmp/gis-arch-$W.json -w '%{http_code}' -X PUT "$B/api/gis/admin/worlds/$W" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"status":"ARCHIVED"}')
  echo "PUT /api/gis/admin/worlds/$W -> $code"
  cat /tmp/gis-arch-$W.json | head -c 400; echo
done

echo
echo "== 归档后 gis_worlds =="
sqlite3 data/guild.db "SELECT id,world_key,server_key,status,is_current FROM gis_worlds ORDER BY id;"

echo
echo "== 公开接口校验 =="
echo -n "GET /api/gis/worlds -> "; curl -s "$B/api/gis/worlds" | head -c 500; echo
echo -n "GET /api/gis/client/bootstrap?serverKey=yl -> "
curl -s "$B/api/gis/client/bootstrap?serverKey=yl" -H "Authorization: Bearer $TOKEN" | head -c 700; echo
echo -n "GET /api/gis/market/locations/count -> "; curl -s "$B/api/gis/market/locations/count"; echo
echo
echo "== 审计（world_update 应出现 2 条，actor=$ADMIN_ID）=="
sqlite3 data/guild.db "SELECT id,event,actor_id,world_id,detail,created_at FROM gis_audit ORDER BY id DESC LIMIT 4;"
echo
echo "== 备份文件 =="
ls -l /root/backups/gis-20261115-gis-fe2/ | tail -5
