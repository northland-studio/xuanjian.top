/**
 * Minecraft 服务器只读对接（当前主要是 115「十一服·历史展览馆」）
 *
 *   GET /api/mc/servers                          服务器清单（不含任何密钥）
 *   GET /api/mc/status?server=s115               基础状态：在线人数/版本/MOTD/延迟（公开，缓存 20 秒）
 *   GET /api/mc/status-detail?server=s115        明细：在线名单/TPS/白名单（**管理员**，走 RCON，缓存 15 秒）
 *
 * 设计约束（115 内存只剩约 180MB 可用，Paper -Xmx1152M）：
 *  - 官网进程只是客户端，115 侧不部署任何常驻进程；
 *  - 基础状态走 Minecraft 原生 Server List Ping，不需要凭据、开销极低；
 *  - RCON 凭据只存在官网 .env（MC_RCON_PASSWORD_<KEY>），不下发前端、不进日志；
 *  - 全部带超时与缓存，115 慢/挂不会拖住官网请求。
 */
const express = require('express');
const logger = require('../lib/logger');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const mc = require('../lib/mc-status');
const router = express.Router();

/** 服务器清单（只回 key/label/host/port，绝不回密码） */
router.get('/servers', (req, res) => {
    const all = mc.servers();
    res.json({
        servers: Object.values(all).map(s => ({
            key: s.key, label: s.label, host: s.host, port: s.port,
            rconConfigured: !!s.rconPassword
        }))
    });
});

/** 基础状态（公开只读，缓存 20 秒，供首页小部件与群机器人使用） */
router.get('/status', async (req, res) => {
    try {
        res.json(await mc.status(String(req.query.server || 's115')));
    } catch (error) {
        logger.error('查询 MC 服务器状态错误:', error);
        res.status(500).json({ error: '查询服务器状态失败' });
    }
});

/** 明细状态（管理员：在线名单 / TPS / 白名单，走 RCON） */
router.get('/status-detail', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        res.json(await mc.detail(String(req.query.server || 's115')));
    } catch (error) {
        logger.error('查询 MC 服务器明细错误:', error);
        res.status(500).json({ error: '查询服务器明细失败' });
    }
});

module.exports = router;
