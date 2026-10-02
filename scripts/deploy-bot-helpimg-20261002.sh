#!/bin/bash
# 把「#help 本地图片缓存」改动部署到 NapCat 主机并重启机器人
# 用法（在 HK 上执行）：先把本地 xuanjian-group-bot/{src,scripts} 传到 /root/deploy-helpimg-20261002/，再运行本脚本
set -e
STAGE=/root/deploy-helpimg-20261002
BOT=/var/www/xuanjian-group-bot
BOTHOST=43.248.3.161
PORT=20043
KEY=/root/.ssh/id_napcat
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -p $PORT root@$BOTHOST"
SCP="scp -i $KEY -o StrictHostKeyChecking=no -P $PORT"

echo "[1/5] 备份远端 src/scripts（只备份一次）..."
# 生产目录原先没有 scripts/（干跑脚本只在开发机），有才备份
$SSH "set -e; cd $BOT; [ -d src.bak-helpimg ] || cp -r src src.bak-helpimg; if [ -d scripts ]; then [ -d scripts.bak-helpimg ] || cp -r scripts scripts.bak-helpimg; fi; mkdir -p scripts; echo '已备份/已就绪'"

echo "[2/5] 上传 src/ 与 scripts/（覆盖式拷贝，不删旧文件）..."
$SSH "rm -rf /tmp/helpimgstage; mkdir -p /tmp/helpimgstage"
$SCP -r "$STAGE/src" "root@$BOTHOST:/tmp/helpimgstage/"
$SCP -r "$STAGE/scripts" "root@$BOTHOST:/tmp/helpimgstage/"
$SSH "set -e; cp -r /tmp/helpimgstage/src/. $BOT/src/; cp -r /tmp/helpimgstage/scripts/. $BOT/scripts/; ls $BOT/src/services/helpCard.ts $BOT/scripts/prewarm-help.mjs"

echo "[3/5] tsc 构建..."
$SSH "set -e; cd $BOT; npm run build"

echo "[4/5] 预热帮助图（POST 官网 → 下载 PNG 到 data/help-cards/）..."
# 预热失败不该挡住重启：功能上会自动退回「发在线地址」，所以这里只告警
$SSH "cd $BOT; node scripts/prewarm-help.mjs || echo '[warn] 预热失败（#help 会退回在线地址，功能不受影响）'; ls -l $BOT/data/help-cards/ 2>/dev/null || echo '（data/help-cards/ 还不存在）'"

echo "[5/5] 重启并检查服务..."
$SSH "set -e; systemctl restart xuanjian-group-bot; sleep 5; systemctl is-active xuanjian-group-bot; journalctl -u xuanjian-group-bot -n 20 --no-pager"
echo "#help 帮助图本地化部署完成 ✓"
