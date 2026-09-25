/**
 * Minecraft 服务器只读对接：状态查询（Server List Ping）与 RCON 客户端
 *
 * 用途：官网与群机器人展示「十一服（115）」的在线人数/版本/MOTD/TPS 等。
 * 设计约束（115 内存紧张）：
 *  - 本模块只是**客户端**，跑在 HK 官网进程里，115 侧不新增任何常驻进程；
 *  - 状态查询走 Minecraft 原生 Server List Ping（25565，无需凭据、开销极低）；
 *  - 需要 TPS/白名单这类信息时用 RCON（25575，凭据只放在官网 .env，不下发到前端）；
 *  - 所有外部调用都带超时与结果缓存，绝不会因为 115 慢/挂而拖住官网请求。
 */
const net = require('net');

/* --------------------------------- 配置 --------------------------------- */

/** 服务器清单：env MC_SERVERS="key=host:port,key2=host:port" */
function servers() {
    const raw = process.env.MC_SERVERS || 's115=115.190.153.44:25565';
    const out = {};
    for (const item of raw.split(',')) {
        const [key, addr] = item.split('=');
        if (!key || !addr) continue;
        const [host, port] = addr.split(':');
        const k = key.trim();
        out[k] = {
            key: k,
            host: (host || '').trim(),
            port: parseInt(port || '25565', 10),
            label: (process.env[`MC_LABEL_${k.toUpperCase()}`] || k).replace(/^"|"$/g, ''),
            // RCON 默认与游戏同机；115 的 25575 被防火墙挡住，走 HK→115 的 SSH 隧道（127.0.0.1:25585）
            rconHost: process.env[`MC_RCON_HOST_${k.toUpperCase()}`] || (host || '').trim(),
            rconPort: parseInt(process.env[`MC_RCON_PORT_${k.toUpperCase()}`] || '25575', 10),
            rconPassword: process.env[`MC_RCON_PASSWORD_${k.toUpperCase()}`] || ''
        };
    }
    return out;
}

function serverOf(key) {
    const all = servers();
    return all[key] || all[Object.keys(all)[0]] || null;
}

/* --------------------------- VarInt / 封包工具 --------------------------- */

function writeVarInt(value) {
    const bytes = [];
    let v = value >>> 0;
    do {
        let temp = v & 0x7f;
        v >>>= 7;
        if (v !== 0) temp |= 0x80;
        bytes.push(temp);
    } while (v !== 0);
    return Buffer.from(bytes);
}

function readVarInt(buf, offset = 0) {
    let result = 0, shift = 0, pos = offset;
    while (pos < buf.length) {
        const b = buf[pos++];
        result |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) return { value: result, size: pos - offset };
        shift += 7;
        if (shift > 35) throw new Error('VarInt 过长');
    }
    throw new Error('VarInt 不完整');
}

function packet(id, payload = Buffer.alloc(0)) {
    const body = Buffer.concat([writeVarInt(id), payload]);
    return Buffer.concat([writeVarInt(body.length), body]);
}

function mcString(str) {
    const b = Buffer.from(String(str), 'utf8');
    return Buffer.concat([writeVarInt(b.length), b]);
}

/* ------------------------- Server List Ping（只读） ------------------------- */

/**
 * 查询服务器状态（协议层，无需凭据）
 * @returns {Promise<{online:boolean, version?:string, protocol?:number, players?:{online:number,max:number,sample:string[]}, motd?:string, latencyMs:number, error?:string}>}
 */
function pingStatus(host, port, timeoutMs = 4000) {
    return new Promise((resolve) => {
        const started = Date.now();
        const socket = new net.Socket();
        let chunks = Buffer.alloc(0);
        let done = false;

        const finish = (result) => {
            if (done) return;
            done = true;
            try { socket.destroy(); } catch (_) { /* 忽略 */ }
            resolve({ latencyMs: Date.now() - started, ...result });
        };

        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => finish({ online: false, error: '超时' }));
        socket.on('error', (e) => finish({ online: false, error: e.code || e.message }));

        socket.on('data', (data) => {
            chunks = Buffer.concat([chunks, data]);
            try {
                const len = readVarInt(chunks, 0);
                const total = len.size + len.value;
                if (chunks.length < total) return;
                let off = len.size;
                const pid = readVarInt(chunks, off); off += pid.size;
                const strLen = readVarInt(chunks, off); off += strLen.size;
                const json = JSON.parse(chunks.slice(off, off + strLen.value).toString('utf8'));
                const desc = json.description;
                const motd = typeof desc === 'string' ? desc
                    : (desc && (desc.text || (Array.isArray(desc.extra) ? desc.extra.map(x => x.text).join('') : ''))) || '';
                finish({
                    online: true,
                    version: json.version && json.version.name,
                    protocol: json.version && json.version.protocol,
                    players: {
                        online: (json.players && json.players.online) || 0,
                        max: (json.players && json.players.max) || 0,
                        sample: ((json.players && json.players.sample) || []).map(p => p.name).slice(0, 30)
                    },
                    motd: String(motd).replace(/\u00a7./g, '').trim()
                });
            } catch (e) {
                finish({ online: false, error: '解析失败：' + e.message });
            }
        });

        socket.connect(port, host, () => {
            const handshake = Buffer.concat([
                writeVarInt(0),      // packet id
                writeVarInt(-1 >>> 0), // protocol version（-1 = 查询用）
                mcString(host),
                Buffer.from([(port >> 8) & 0xff, port & 0xff]),
                writeVarInt(1)       // next state: status
            ]);
            socket.write(Buffer.concat([writeVarInt(handshake.length), handshake]));
            socket.write(packet(0x00));
        });
    });
}

/* ------------------------------ RCON 客户端 ------------------------------ */

/**
 * 执行一条 RCON 命令（只读用途为主：list / tps / whitelist list）
 * @returns {Promise<{ok:boolean, body?:string, error?:string}>}
 */
function rconExec({ host, port, password, command, timeoutMs = 5000 }) {
    return new Promise((resolve) => {
        if (!password) return resolve({ ok: false, error: '未配置 RCON 密码' });
        const socket = new net.Socket();
        let buf = Buffer.alloc(0);
        let authed = false;
        let done = false;
        let reqId = 1;

        const finish = (r) => {
            if (done) return;
            done = true;
            try { socket.destroy(); } catch (_) { /* 忽略 */ }
            resolve(r);
        };

        socket.setTimeout(timeoutMs);
        socket.on('timeout', () => finish({ ok: false, error: 'RCON 超时' }));
        socket.on('error', (e) => finish({ ok: false, error: e.code || e.message }));

        const send = (id, type, body) => {
            const payload = Buffer.from(body, 'utf8');
            const head = Buffer.alloc(12);
            head.writeInt32LE(10 + payload.length, 0);
            head.writeInt32LE(id, 4);
            head.writeInt32LE(type, 8);
            socket.write(Buffer.concat([head, payload, Buffer.from([0, 0])]));
        };

        socket.on('data', (data) => {
            buf = Buffer.concat([buf, data]);
            while (buf.length >= 12) {
                const size = buf.readInt32LE(0);
                if (buf.length < size + 4) break;
                const id = buf.readInt32LE(4);
                const pkt = buf.slice(8, size + 2).toString('utf8');
                buf = buf.slice(size + 4);
                if (id === -1) return finish({ ok: false, error: 'RCON 密码错误' });
                if (!authed) { authed = true; send(++reqId, 2, command); continue; }
                return finish({ ok: true, body: pkt.replace(/\u00a7./g, '').trim() });
            }
        });

        socket.connect(port, host, () => send(reqId, 3, password));
    });
}

/* ------------------------------ 带缓存查询 ------------------------------ */

const cache = new Map();

async function cached(key, ttlMs, producer) {
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < ttlMs) return hit.value;
    const value = await producer();
    cache.set(key, { at: now, value });
    return value;
}

/** 状态查询（默认缓存 20 秒，避免群里连点打爆 115） */
async function status(key) {
    const s = serverOf(key);
    if (!s) return { online: false, error: '未配置服务器' };
    return cached(`status:${s.key}`, 20000, async () => {
        const r = await pingStatus(s.host, s.port);
        return { server: { key: s.key, label: s.label, host: s.host, port: s.port }, ...r };
    });
}

/** 明细（TPS / 在线名单 / 白名单）：走 RCON，默认缓存 15 秒；失败时优雅降级为状态层数据 */
async function detail(key) {
    const s = serverOf(key);
    if (!s) return { online: false, error: '未配置服务器' };
    const base = await status(key);
    if (!base.online) return base;
    return cached(`detail:${s.key}`, 15000, async () => {
        const cfg = { host: s.rconHost, port: s.rconPort, password: s.rconPassword };
        const [list, tps, white] = await Promise.all([
            rconExec({ ...cfg, command: 'list' }),
            rconExec({ ...cfg, command: 'tps' }),
            rconExec({ ...cfg, command: 'whitelist list' })
        ]);
        return {
            ...base,
            rcon: { configured: !!s.rconPassword, list: list.ok ? list.body : null, listError: list.ok ? null : list.error },
            tps: tps.ok ? tps.body : null,
            tpsError: tps.ok ? null : tps.error,
            whitelist: white.ok ? white.body : null,
            whitelistError: white.ok ? null : white.error
        };
    });
}

module.exports = { servers, serverOf, pingStatus, rconExec, status, detail, writeVarInt, readVarInt };
