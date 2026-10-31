/**
 * 管理员号 NapCat 实时登录二维码服务（HK 127.0.0.1:3911）
 *
 * 作用：随时访问都能拿到「当前有效」的二维码，避免静态图片过期。
 * 实现：每次请求（带 2 秒缓存）通过 ssh 到机器人服务器读取 qrcode.png。
 * 安全：URL 带随机密钥；只读二维码，不暴露其它信息；只监听 127.0.0.1，由 nginx 反代。
 */
import http from 'node:http';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.QR_PORT || 3911);
const SECRET = process.env.QR_SECRET || 'change-me';
const CACHE_MS = 2000;

let cache = { at: 0, buf: null, err: null };

function fetchQr() {
    return new Promise((resolve) => {
        execFile(
            'ssh',
            [
                '-i', '/root/.ssh/id_napcat',
                '-p', '20043',
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'ConnectTimeout=6',
                '-o', 'BatchMode=yes',
                'root@43.248.3.161',
                'base64 -w0 /opt/napcat-admin/qq/napcat/cache/qrcode.png',
            ],
            { timeout: 12000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => {
                if (err) return resolve({ buf: null, err: err.message.slice(0, 120) });
                try {
                    resolve({ buf: Buffer.from(stdout.trim(), 'base64'), err: null });
                } catch (e) {
                    resolve({ buf: null, err: 'decode failed' });
                }
            }
        );
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    // 路径：/<secret>.png
    const m = url.pathname.match(/^\/([A-Za-z0-9_-]+)\.png$/);
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

    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Length': cache.buf.length,
    });
    res.end(cache.buf);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[qr] 实时二维码服务已启动 127.0.0.1:${PORT}（路径 /<QR_SECRET>.png）`);
});
