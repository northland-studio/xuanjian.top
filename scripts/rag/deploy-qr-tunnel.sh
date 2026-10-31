#!/bin/bash
# HK：新增 13005 → 机器人服务器 3999（二维码 HTTP），并把 notice-qr 改成走隧道
set -u
SECRET=$(cat /opt/notice-qr/secret.txt)

echo "=== 1. 新建隧道 13005 → bot:3999 ==="
cat > /opt/napcat-qr-tunnel.sh <<'EOS'
#!/bin/bash
while true; do
  ssh -i /root/.ssh/id_napcat -p 20043 \
      -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -N \
      -L 13005:127.0.0.1:3999 root@43.248.3.161
  echo "[$(date '+%F %T')] 二维码隧道断开，5 秒后重连" >> /tmp/napcat-qr-tunnel.log
  sleep 5
done
EOS
chmod +x /opt/napcat-qr-tunnel.sh
if pm2 describe napcat-qr-tunnel >/dev/null 2>&1; then
  pm2 restart napcat-qr-tunnel >/dev/null 2>&1; echo "  隧道已重启"
else
  pm2 start /opt/napcat-qr-tunnel.sh --name napcat-qr-tunnel --interpreter none >/dev/null 2>&1; echo "  隧道已创建"
fi
pm2 save >/dev/null 2>&1 || true
sleep 5
echo -n "  13005 监听: "; ss -lnt 2>/dev/null | grep -c ':13005 ' || true
echo -n "  隧道读取二维码: "; curl -s -o /tmp/q2.png -w '%{http_code} %{size_download}B\n' --max-time 10 http://127.0.0.1:13005/

echo
echo "=== 2. 改写 notice-qr 服务：不再 ssh，直接读隧道 ==="
cat > /opt/notice-qr/qr-server.mjs <<'JS'
/**
 * 管理员号 NapCat 实时登录二维码（HK 127.0.0.1:3911）
 * 数据源：隧道 13005 → 机器人服务器 127.0.0.1:3999（读取 qrcode.png）
 * 每次请求实时读取（2 秒缓存），保证二维码始终是最新一张。
 */
import http from 'node:http';

const PORT = Number(process.env.QR_PORT || 3911);
const SECRET = process.env.QR_SECRET || 'change-me';
const UPSTREAM = process.env.QR_UPSTREAM || 'http://127.0.0.1:13005/';
const CACHE_MS = 2000;

let cache = { at: 0, buf: null, err: null };

async function fetchQr() {
    try {
        const r = await fetch(UPSTREAM, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return { buf: null, err: 'upstream ' + r.status };
        const ab = await r.arrayBuffer();
        return { buf: Buffer.from(ab), err: null };
    } catch (e) {
        return { buf: null, err: String((e && e.message) || e).slice(0, 120) };
    }
}

const server = http.createServer(async (req, res) => {
    const m = new URL(req.url, 'http://127.0.0.1').pathname.match(/^\/([A-Za-z0-9_-]+)\.png$/);
    if (!m || m[1] !== SECRET) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found');
    }
    const now = Date.now();
    if (now - cache.at > CACHE_MS || !cache.buf) {
        const r = await fetchQr();
        cache = { at: now, buf: r.buf, err: r.err };
    }
    if (!cache.buf) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('二维码暂时取不到：' + (cache.err || 'unknown'));
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': cache.buf.length });
    res.end(cache.buf);
});

server.listen(PORT, '127.0.0.1', () => console.log('[qr] 实时二维码服务 127.0.0.1:' + PORT + ' ← ' + UPSTREAM));
JS
pm2 restart notice-qr --update-env >/dev/null 2>&1 || pm2 start /opt/notice-qr/qr-server.mjs --name notice-qr --interpreter node >/dev/null
sleep 3

echo
echo "=== 3. 验证 ==="
echo -n "  本地 3911: "; curl -s -o /tmp/q3.png -w '%{http_code} %{content_type} %{size_download}B\n' --max-time 12 "http://127.0.0.1:3911/$SECRET.png"
file /tmp/q3.png 2>/dev/null | head -1
echo -n "  公网 /qr-admin: "; curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' --max-time 20 "https://notice.xuanjian.top/qr-admin/$SECRET.png"
echo
echo "  ★ 实时二维码地址：https://notice.xuanjian.top/qr-admin/$SECRET.png"
