#!/bin/bash
# 把机器人（xuanjian-group-bot）的阶段 6 改动部署到 NapCat 主机并重启服务
# 用法（在 HK 上执行）：把本地 xuanjian-group-bot/src 传到 /root/deploy-bot-20260925/src 后运行本脚本
set -e
STAGE=/root/deploy-bot-20260925
BOT=/var/www/xuanjian-group-bot
BOTHOST=43.248.3.161
PORT=20043
KEY=/root/.ssh/id_napcat
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -p $PORT root@$BOTHOST"
SCP="scp -i $KEY -o StrictHostKeyChecking=no -P $PORT"

echo "[1/4] 备份远端 src 并准备目录..."
$SSH "set -e; [ -d $BOT/src.bak-20260925 ] || cp -r $BOT/src $BOT/src.bak-20260925; mkdir -p /tmp/botstage; ls $BOT/src"

echo "[2/4] 上传 src 源码..."
$SCP -r "$STAGE/src/." "root@$BOTHOST:/tmp/botstage/"
$SSH "set -e; cp -r /tmp/botstage/. $BOT/src/; ls -R $BOT/src | head -20"

echo "[3/4] 构建（tsc）并重启服务..."
$SSH "set -e; cd $BOT; npm run build; systemctl restart xuanjian-group-bot; sleep 5; systemctl is-active xuanjian-group-bot"

echo "[4/4] 服务日志..."
$SSH "journalctl -u xuanjian-group-bot -n 15 --no-pager"
echo "机器人部署完成 ✓"
