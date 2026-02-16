#!/bin/bash

# 玄剑公会官网备份系统部署脚本
# 可以从任意目录运行

set -e

echo "=========================================="
echo "   玄剑公会官网备份系统部署"
echo "=========================================="

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="/var/www/xuanjian-guild"
BACKUP_DIR="/var/beifen"
LOG_FILE="/var/log/xuanjian-backup.log"

# 1. 创建目录
echo "[1/6] 创建必要目录..."
mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE"

# 2. 复制 systemd 文件
echo "[2/6] 安装 systemd 服务文件..."
cp -f "${SCRIPT_DIR}/xuanjian-backup.service" /etc/systemd/system/
cp -f "${SCRIPT_DIR}/xuanjian-backup.timer" /etc/systemd/system/

# 3. 设置权限
echo "[3/6] 设置文件权限..."
chmod +x "${SCRIPT_DIR}/backup.sh"
chmod 644 /etc/systemd/system/xuanjian-backup.service
chmod 644 /etc/systemd/system/xuanjian-backup.timer

# 4. 重载 systemd
echo "[4/6] 重载 systemd 配置..."
systemctl daemon-reload

# 5. 启用并启动定时器
echo "[5/6] 启用备份定时器..."
systemctl enable xuanjian-backup.timer
systemctl start xuanjian-backup.timer

# 6. 显示状态
echo "[6/6] 检查服务状态..."
systemctl status xuanjian-backup.timer --no-pager

echo ""
echo "=========================================="
echo "   部署完成!"
echo "=========================================="
echo ""
echo "备份时间: 每天 03:00"
echo "备份目录: $BACKUP_DIR"
echo "日志文件: $LOG_FILE"
echo "保留天数: 30 天"
echo ""
echo "常用命令:"
echo "  查看定时器状态: systemctl status xuanjian-backup.timer"
echo "  查看所有定时器: systemctl list-timers"
echo "  手动执行备份:   systemctl start xuanjian-backup.service"
echo "  查看备份日志:   tail -f $LOG_FILE"
echo "  查看备份列表:   ls -lh $BACKUP_DIR"
echo ""
