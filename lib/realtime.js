/**
 * WebSocket 实时通知模块
 * 维护 用户ID → WebSocket 连接 映射，通知创建后可实时推送给在线用户。
 * 前端通过 /ws?token=xxx 连接，鉴权通过后加入对应用户频道。
 */
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('./logger');

const JWT_SECRET = process.env.JWT_SECRET || 'xuanjian_guild_secret_key_2024';

/** userId -> Set<ws> */
const clients = new Map();

/**
 * 初始化 WebSocket 服务器（与 HTTP server 共享端口）
 * @param {http.Server} server Express 的 http server
 */
function initRealtime(server) {
    const wss = new WebSocket.Server({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
        // 从 URL 参数解析 token 鉴权：/ws?token=xxx
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token') || '';
        let userId = null;
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                userId = decoded.userId;
            } catch (e) {
                userId = null;
            }
        }
        if (!userId) {
            ws.close(4001, 'unauthorized');
            return;
        }
        ws.userId = userId;
        if (!clients.has(userId)) clients.set(userId, new Set());
        clients.get(userId).add(ws);
        ws.on('close', () => {
            const set = clients.get(userId);
            if (set) {
                set.delete(ws);
                if (set.size === 0) clients.delete(userId);
            }
        });
        // 连接成功后发送确认（前端可据此判断已连接）
        try { ws.send(JSON.stringify({ type: 'connected' })); } catch (e) { /* 忽略 */ }
    });

    wss.on('error', (err) => logger.error('WebSocket 服务器错误:', err.message));
    logger.info('WebSocket 实时通知服务已启动 (/ws)');
    return wss;
}

/**
 * 向指定用户的所有在线连接广播一条消息
 * @param {number} userId 目标用户
 * @param {object} payload 消息体（JSON 可序列化）
 */
function broadcastToUser(userId, payload) {
    const set = clients.get(userId);
    if (!set || set.size === 0) return false;
    const msg = JSON.stringify(payload);
    let sent = 0;
    for (const ws of set) {
        if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(msg); sent++; } catch (e) { /* 单个连接失败不影响其他 */ }
        }
    }
    return sent > 0;
}

module.exports = { initRealtime, broadcastToUser, clients };
