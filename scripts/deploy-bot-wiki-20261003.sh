#!/bin/bash
# 把「Wiki 词条卡片（#wiki + #[序号] 出图）」部署到 NapCat 主机并重启机器人
# 用法（在 HK 上执行）：先把本地 xuanjian-group-bot/src 传到 /root/deploy-wiki-bot/，再运行本脚本
set -e
STAGE=/root/deploy-wiki-bot
BOT=/var/www/xuanjian-group-bot
BOTHOST=43.248.3.161
PORT=20043
KEY=/root/.ssh/id_napcat
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -p $PORT root@$BOTHOST"
SCP="scp -i $KEY -o StrictHostKeyChecking=no -P $PORT"

echo "[1/5] 先验证官网出图接口可用（机器人取的就是这张图）"
code=$(curl -s -o /tmp/wikicard-check.png -w '%{http_code}' "http://localhost:3000/api/wiki/card/hong-shi-bi-jiao-qi.png")
echo "      官网 card 接口 HTTP $code，大小 $(wc -c < /tmp/wikicard-check.png) 字节"
[ "$code" = "200" ] || { echo "官网出图不可用，先修官网再部署机器人"; exit 1; }

echo "[2/5] 备份远端 src（只备份一次）"
$SSH "set -e; cd $BOT; [ -d src.bak-wiki ] || cp -r src src.bak-wiki; echo '      已备份 src.bak-wiki'"

echo "[3/5] 上传 src/"
$SSH "rm -rf /tmp/wikistage; mkdir -p /tmp/wikistage"
$SCP -r "$STAGE/src" "root@$BOTHOST:/tmp/wikistage/"
$SSH "set -e; cp -r /tmp/wikistage/src/. $BOT/src/; ls -l $BOT/src/handlers/wiki.ts $BOT/src/services/wikiCard.ts"

echo "[4/5] tsc 构建"
$SSH "set -e; cd $BOT; npm run build; ls -l dist/handlers/wiki.js dist/services/wikiCard.js"

echo "[5/5] 重启并检查"
$SSH "set -e; systemctl restart xuanjian-group-bot; sleep 5; systemctl is-active xuanjian-group-bot; journalctl -u xuanjian-group-bot -n 12 --no-pager | tail -12"
echo "Wiki 词条卡片部署完成 ✓（群里发 #wiki 红石 试试）"
