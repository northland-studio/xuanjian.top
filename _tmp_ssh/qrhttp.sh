#!/bin/bash
set -u
DIR=/opt/napcat-admin/qr-http
mkdir -p "$DIR"
cat > "$DIR/server.mjs" <<'JS'
import http from 'node:http';
import fs from 'node:fs';
const FILE = '/opt/napcat-admin/qq/napcat/cache/qrcode.png';
const PORT = Number(process.env.QR_PORT || 3999);
http.createServer((req, res) => {
  try {
    const buf = fs.readFileSync(FILE);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': buf.length });
    res.end(buf);
  } catch (e) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('二维码文件暂不可用：' + (e && e.message));
  }
}).listen(PORT, '127.0.0.1', () => console.log('[qr-http] serving ' + FILE + ' on 127.0.0.1:' + PORT));
JS
if pm2 describe qr-http >/dev/null 2>&1; then
  pm2 restart qr-http --update-env >/dev/null
else
  pm2 start "$DIR/server.mjs" --name qr-http --interpreter node >/dev/null
fi
pm2 save >/dev/null 2>&1 || true
sleep 3
echo -n "  本地自测: "
curl -s -o /tmp/q.png -w '%{http_code} %{size_download}B\n' --max-time 8 http://127.0.0.1:3999/
ss -lntp 2>/dev/null | grep ':3999' | head -1