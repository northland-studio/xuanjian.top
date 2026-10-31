#!/bin/bash
# 机器人服务器：部署第二个 NapCat 实例（管理员自己的 QQ），端口 3002
# 与现有实例完全隔离：独立 HOME、独立数据目录、独立端口、独立 pm2 进程
set -eu

ADMIN_HOME=/opt/napcat-admin
SRC=/opt/napcat
PORT=3002
WEBUI_PORT=6100

echo "=== 1. 资源检查 ==="
free -m | head -2
df -h / | tail -1
echo "  现有实例："; ss -lntp 2>/dev/null | grep -E ':(3001|6099)' | head -3

echo
echo "=== 2. 创建独立 HOME 与目录 ==="
mkdir -p "$ADMIN_HOME"/{.config,xvfb}
if [ ! -d "$ADMIN_HOME/qq" ]; then
  echo "  复制 QQ 运行目录（squashfs-root，约 240MB）..."
  cp -a "$SRC/squashfs-root" "$ADMIN_HOME/qq"
  echo "  完成"
else
  echo "  已存在，跳过复制"
fi
ls -d "$ADMIN_HOME/qq" && du -sh "$ADMIN_HOME/qq"

echo
echo "=== 3. 写启动脚本 ==="
cat > "$ADMIN_HOME/run-admin-napcat.sh" <<'EOS'
#!/bin/bash
# 管理员号 NapCat 实例（独立 HOME + 独立端口 3002）
export HOME=/opt/napcat-admin
export APPDIR=/opt/napcat-admin/qq
export DISPLAY=:100
cd /opt/napcat-admin/qq || exit 1
# 独立 Xvfb
if ! pgrep -f "Xvfb :100" >/dev/null; then
  Xvfb :100 -screen 0 1280x720x24 > /tmp/xvfb-admin.log 2>&1 &
  sleep 2
fi
# NapCat 配置：改 WS 端口为 3002、WebUI 6100
CFG=/opt/napcat-admin/.config/QQ/NapCat/config
mkdir -p "$CFG"
if [ -f /opt/napcat/.env ]; then set -a; . /opt/napcat/.env; set +a; fi
# 管理员账号由环境文件提供
[ -f /opt/napcat-admin/admin.env ] && { set -a; . /opt/napcat-admin/admin.env; set +a; }
exec ./qq --no-sandbox --disable-gpu --disable-dev-shm-usage
EOS
chmod +x "$ADMIN_HOME/run-admin-napcat.sh"

echo
echo "=== 4. 写账号环境文件模板 ==="
if [ ! -f "$ADMIN_HOME/admin.env" ]; then
  cat > "$ADMIN_HOME/admin.env" <<'EOS'
# 管理员自己的 QQ —— 由管理员本人填写；留空则每次启动需扫码登录
NAPCAT_QUICK_ACCOUNT=
NAPCAT_QUICK_PASSWORD=
# 该实例的 OneBot WS 端口（HK 侧隧道指向这里）
NAPCAT_WS_PORT=3002
EOS
  chmod 600 "$ADMIN_HOME/admin.env"
  echo "  已生成 $ADMIN_HOME/admin.env（待填写）"
fi

echo
echo "=== 5. 注册 pm2 进程 ==="
if pm2 describe napcat-admin >/dev/null 2>&1; then
  echo "  已存在，重载"
  pm2 restart napcat-admin --update-env >/dev/null
else
  pm2 start "$ADMIN_HOME/run-admin-napcat.sh" --name napcat-admin --interpreter none >/dev/null
fi
pm2 save >/dev/null 2>&1 || true
pm2 list 2>/dev/null | grep -E 'napcat-admin|napcat-guard' | head -3

echo
echo "=== 6. 状态 ==="
sleep 8
echo -n "  3002 监听: "; ss -lntp 2>/dev/null | grep -c ':3002' || true
echo "  日志尾部："
pm2 logs napcat-admin --lines 15 --nostream 2>/dev/null | tail -12

echo
echo "=== 7. 下一步（人工）==="
cat <<'EOS'
  1) 首次启动需扫码登录管理员 QQ：
     - 查看日志里的二维码（pm2 logs napcat-admin --lines 60 --nostream | tail -40）
     或用 WebUI：HK 上 ssh -L 6100:127.0.0.1:6100 root@43.248.3.161 -p 20043
     然后浏览器打开 http://127.0.0.1:6100
  2) 登录后到 NapCat 设置里确认 OneBot v11 正向 WS 端口 = 3002
  3) HK 上加隧道：ssh -L 13004:127.0.0.1:3002 root@43.248.3.161 -p 20043 -N
  4) notice 的 .env 里 NOTICE_ACCOUNTS 增加第二项：
     {"id":"admin","name":"管理员号","port":13004,"token":"<该实例的 token>","enabled":true}
  5) pm2 restart xuanjian-notice
EOS
