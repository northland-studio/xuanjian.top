/**
 * 队伍信息采集公示系统（NorthTeam）· 服务端接口
 *
 * 契约见 H:\chengxuyuanma\north-team\docs\API.md，改这里必须同步改那边。
 *
 * 三组接口：
 *   ① 无认证公示读   GET  /api/team/public            （只返回 is_public=1）
 *                    GET  /api/team/public/:id
 *   ② 插件通道（X-Server-Key，复用 mod_servers.server_key）
 *                    GET  /api/team/list               （全量列表，含未公示）
 *                    GET  /api/team/export/:id         （完整配置，含未公示）
 *                    POST /api/team/import             （把服务器现状采集回官网，落库为未公示草稿）
 *   ③ 管理写（JWT + 管理员）
 *                    GET/POST/PUT/DELETE /api/team/configs[/:id]
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

/* ==================== 常量与校验规则 ==================== */
const COLORS = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold',
    'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white'];
const VISIBILITIES = ['always', 'hideForOtherTeams', 'hideForOwnTeam', 'never'];
const COLLISION_RULES = ['always', 'pushOtherTeams', 'pushOwnTeam', 'never'];
const POSITIONS = ['sidebar', 'list', 'below_name'];
const SCORE_MODES = ['member_count', 'fixed'];

const MAX_UNITS = 32;
const MAX_MEMBERS_PER_UNIT = 100;
const MAX_TEXT = 64;
// 1.1.0：prefix/suffix 从 64 放宽到 256 —— MiniMessage 标签很占长度
// （<dark_gray>…</dark_gray> 一段就 21 字符），多段变色时 64 很容易撞上限。
// 现代版本的前后缀是 Component，原版无硬性长度限制，只有客户端显示上的截断。
const MAX_PREFIX = 256;
const KEY_RE = /^[a-z0-9_]{1,13}$/;   // 13 位：插件侧拼成 nt_<key> 后正好 16，卡在原版记分板队伍名上限内
const PLAYER_RE = /^[A-Za-z0-9_]{1,16}$/;
const OBJECTIVE_RE = /^[A-Za-z0-9_.-]{1,32}$/;

/**
 * 去掉 MiniMessage 标签与传统颜色码后的可见长度。
 * display_name 按这个口径限制（颜色标签不占额度），与插件侧校验器一致。
 */
function visibleLength(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&[0-9a-fk-or]/gi, '')
        .length;
}

const bool = v => v === true || v === 1 || v === '1' || v === 'true';

/* ==================== 插件鉴权：X-Server-Key ==================== */
async function serverKeyAuth(req, res, next) {
    try {
        const key = req.headers['x-server-key'];
        if (!key) return res.status(401).json({ error: '缺少服务器密钥 (X-Server-Key)' });
        const server = await db.get('SELECT * FROM mod_servers WHERE server_key = ?', [key]);
        if (!server) return res.status(401).json({ error: '服务器密钥无效' });
        req.modServer = server;
        next();
    } catch (e) {
        logger.error('队伍插件鉴权错误:', e);
        res.status(500).json({ error: '鉴权失败' });
    }
}

/* ==================== 组装 / 校验 ==================== */
/**
 * 还原 unit_scores（DB 里存 JSON 文本）。
 * 坏数据退化为空对象而不是抛错 —— 这是公示读接口，宁可少显示也不能 500。
 */
function parseUnitScores(raw) {
    if (!raw) return {};
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out = {};
        for (const [k, v] of Object.entries(parsed)) {
            const n = Number(v);
            if (k && Number.isFinite(n)) out[k] = Math.trunc(n);
        }
        return out;
    } catch (e) {
        return {};
    }
}

function shapeConfig(row, units) {
    return {
        schema: 1,
        id: row.id,
        name: row.name,
        description: row.description || '',
        event_date: row.event_date || null,
        is_public: !!row.is_public,
        version: row.updated_at,
        scoreboard: {
            enabled: !!row.scoreboard_enabled,
            objective: row.scoreboard_objective,
            display_name: row.scoreboard_display_name,
            position: row.scoreboard_position,
            score_mode: row.scoreboard_score_mode,
            // 1.1.0：fixed 模式下每队的固定分，插件会把数字显示在队头行「队伍名 · N」里
            unit_scores: parseUnitScores(row.scoreboard_unit_scores)
        },
        units: units.map(u => ({
            key: u.key,
            display_name: u.display_name,
            color: u.color,
            prefix: u.prefix || '',
            suffix: u.suffix || '',
            friendly_fire: !!u.friendly_fire,
            see_friendly_invisibles: !!u.see_friendly_invisibles,
            nametag_visibility: u.nametag_visibility,
            death_message_visibility: u.death_message_visibility,
            collision_rule: u.collision_rule,
            sort_order: u.sort_order,
            members: u.members
        }))
    };
}

async function loadUnits(configId) {
    const units = await db.all(
        'SELECT * FROM team_units WHERE config_id = ? ORDER BY sort_order ASC, id ASC', [configId]);
    for (const u of units) {
        const rows = await db.all('SELECT player_name FROM team_members WHERE unit_id = ? ORDER BY id ASC', [u.id]);
        u.members = rows.map(r => r.player_name);
    }
    return units;
}

async function loadConfig(id) {
    const row = await db.get('SELECT * FROM team_configs WHERE id = ?', [id]);
    if (!row) return null;
    return shapeConfig(row, await loadUnits(id));
}

function summarize(cfg, withTeams = false) {
    const memberCount = cfg.units.reduce((n, u) => n + u.members.length, 0);
    const out = {
        id: cfg.id,
        name: cfg.name,
        event_date: cfg.event_date,
        is_public: cfg.is_public,
        version: cfg.version,
        unit_count: cfg.units.length,
        member_count: memberCount
    };
    if (withTeams) {
        out.teams = cfg.units.map(u => ({
            key: u.key, display_name: u.display_name, color: u.color, member_count: u.members.length
        }));
    }
    return out;
}

function validatePayload(body) {
    if (!body || typeof body !== 'object') return { ok: false, error: '请求体为空' };

    const name = String(body.name || '').trim();
    if (!name || name.length > MAX_TEXT) return { ok: false, error: `配置名称必填且不超过 ${MAX_TEXT} 字符` };
    const description = String(body.description || '').slice(0, 500);
    const event_date = body.event_date ? String(body.event_date).slice(0, 32) : null;

    const sb = (body.scoreboard && typeof body.scoreboard === 'object') ? body.scoreboard : {};
    const objective = String(sb.objective || 'nt_teams').trim() || 'nt_teams';
    if (!OBJECTIVE_RE.test(objective)) return { ok: false, error: '记分板 objective 名称不合法（只允许字母数字._-）' };
    const display_name = String(sb.display_name || '<gold>队伍</gold>').slice(0, MAX_PREFIX);
    const displayNameVisible = visibleLength(display_name);
    if (!displayNameVisible) {
        return { ok: false, error: '记分板 display_name 不能只有颜色标签' };
    }
    if (displayNameVisible > 32) {
        return { ok: false, error: `记分板 display_name 可见长度 ${displayNameVisible} 超过 32 字符（颜色标签不占额度）` };
    }
    const position = POSITIONS.includes(sb.position) ? sb.position : 'sidebar';
    const score_mode = SCORE_MODES.includes(sb.score_mode) ? sb.score_mode : 'member_count';

    const unitsIn = Array.isArray(body.units) ? body.units : [];
    if (unitsIn.length === 0) return { ok: false, error: '至少需要配置一个队伍' };
    if (unitsIn.length > MAX_UNITS) return { ok: false, error: `队伍数量不能超过 ${MAX_UNITS} 个` };

    const units = [];
    const keys = new Set();
    const owner = new Map();
    for (let i = 0; i < unitsIn.length; i++) {
        const u = unitsIn[i] || {};
        const key = String(u.key || '').trim().toLowerCase();
        if (!KEY_RE.test(key)) return { ok: false, error: `第 ${i + 1} 个队伍的 key 不合法（只允许 a-z0-9_，≤13 位）` };
        if (keys.has(key)) return { ok: false, error: `队伍 key 重复: ${key}` };
        keys.add(key);

        const uname = String(u.display_name || '').trim();
        const unameVisible = visibleLength(uname);
        if (!unameVisible) return { ok: false, error: `队伍 ${key} 的显示名必填（不能只有颜色标签）` };
        if (unameVisible > 32) return { ok: false, error: `队伍 ${key} 的显示名可见长度 ${unameVisible} 超过 32 字符（颜色标签不占额度）` };
        if (uname.length > MAX_PREFIX) return { ok: false, error: `队伍 ${key} 的显示名原始长度 ${uname.length} 超过 ${MAX_PREFIX}（颜色标签过多）` };
        if (!COLORS.includes(u.color)) return { ok: false, error: `队伍 ${key} 的颜色不在允许列表（16 种原版颜色）` };

        // prefix/suffix：1.1.0 起上限 256（含标签）。以前是 slice 静默截断，现在明确报错，
        // 避免管理员以为存上了其实被砍掉一半。
        for (const [field, rawValue] of [['prefix', u.prefix], ['suffix', u.suffix]]) {
            const text = String(rawValue || '');
            if (text.length > MAX_PREFIX) {
                return { ok: false, error: `队伍 ${key} 的 ${field} 长度 ${text.length} 超过上限 ${MAX_PREFIX}（含颜色标签）` };
            }
        }

        const members = [];
        const seen = new Set();
        const rawMembers = Array.isArray(u.members) ? u.members : [];
        if (rawMembers.length > MAX_MEMBERS_PER_UNIT) {
            return { ok: false, error: `队伍 ${key} 的成员数不能超过 ${MAX_MEMBERS_PER_UNIT}` };
        }
        for (const raw of rawMembers) {
            const m = String(raw || '').trim();
            if (!m) continue;
            if (!PLAYER_RE.test(m)) return { ok: false, error: `队伍 ${key} 的成员名不合法: ${m}（只允许字母数字下划线，≤16 位）` };
            const lower = m.toLowerCase();
            if (seen.has(lower)) continue;
            seen.add(lower);
            if (owner.has(lower)) return { ok: false, error: `玩家 ${m} 同时出现在 ${owner.get(lower)} 和 ${key}` };
            owner.set(lower, key);
            members.push(m);
        }

        units.push({
            key,
            display_name: uname,
            color: u.color,
            prefix: String(u.prefix || ''),
            suffix: String(u.suffix || ''),
            friendly_fire: bool(u.friendly_fire) ? 1 : 0,
            see_friendly_invisibles: u.see_friendly_invisibles === false || u.see_friendly_invisibles === 0 ? 0 : 1,
            nametag_visibility: VISIBILITIES.includes(u.nametag_visibility) ? u.nametag_visibility : 'always',
            death_message_visibility: VISIBILITIES.includes(u.death_message_visibility) ? u.death_message_visibility : 'always',
            collision_rule: COLLISION_RULES.includes(u.collision_rule) ? u.collision_rule : 'always',
            sort_order: Number.isFinite(+u.sort_order) && +u.sort_order > 0 ? +u.sort_order : i + 1,
            members
        });
    }

    // unit_scores（1.1.0）：仅 fixed 模式使用，key 必须对应本配置里的队伍，值必须是整数。
    // 数值只用于显示在队头行文本里（插件侧），不参与排序。
    const unit_scores = {};
    const rawScores = (sb.unit_scores && typeof sb.unit_scores === 'object' && !Array.isArray(sb.unit_scores))
        ? sb.unit_scores : {};
    for (const [rawKey, rawValue] of Object.entries(rawScores)) {
        const key = String(rawKey || '').trim().toLowerCase();
        if (!key) continue;
        if (!keys.has(key)) {
            return { ok: false, error: `记分板 unit_scores 里的 key「${rawKey}」不对应任何队伍` };
        }
        const n = Number(rawValue);
        if (!Number.isFinite(n)) {
            return { ok: false, error: `记分板 unit_scores.${key} 必须是整数` };
        }
        const value = Math.trunc(n);
        if (Math.abs(value) > 1000000) {
            return { ok: false, error: `记分板 unit_scores.${key} 数值过大（|值| ≤ 1000000）` };
        }
        unit_scores[key] = value;
    }

    return {
        ok: true,
        data: {
            name, description, event_date,
            is_public: bool(body.is_public) ? 1 : 0,
            scoreboard: {
                enabled: bool(sb.enabled) ? 1 : 0,
                objective, display_name, position, score_mode, unit_scores
            },
            units
        }
    };
}

/** 写入（新建 / 覆盖更新），units 与 members 整体替换 */
async function saveConfig(data, { id = null, createdBy = null, forcePrivate = false } = {}) {
    const now = getLocalTimestamp();
    let configId = id;
    const isPublic = forcePrivate ? 0 : data.is_public;

    await db.transaction(async () => {
        if (configId) {
            await db.run(
                `UPDATE team_configs SET name=?, description=?, event_date=?, is_public=?,
                   scoreboard_enabled=?, scoreboard_objective=?, scoreboard_display_name=?,
                   scoreboard_position=?, scoreboard_score_mode=?, scoreboard_unit_scores=?, updated_at=?
                 WHERE id=?`,
                [data.name, data.description, data.event_date, isPublic,
                    data.scoreboard.enabled, data.scoreboard.objective, data.scoreboard.display_name,
                    data.scoreboard.position, data.scoreboard.score_mode,
                    JSON.stringify(data.scoreboard.unit_scores || {}), now, configId]
            );
            await db.run(
                'DELETE FROM team_members WHERE unit_id IN (SELECT id FROM team_units WHERE config_id = ?)', [configId]);
            await db.run('DELETE FROM team_units WHERE config_id = ?', [configId]);
        } else {
            const r = await db.run(
                `INSERT INTO team_configs
                 (name, description, event_date, is_public, scoreboard_enabled, scoreboard_objective,
                  scoreboard_display_name, scoreboard_position, scoreboard_score_mode, scoreboard_unit_scores,
                  created_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [data.name, data.description, data.event_date, isPublic,
                    data.scoreboard.enabled, data.scoreboard.objective, data.scoreboard.display_name,
                    data.scoreboard.position, data.scoreboard.score_mode,
                    JSON.stringify(data.scoreboard.unit_scores || {}), createdBy, now, now]
            );
            configId = r.id;
        }

        for (const u of data.units) {
            const ur = await db.run(
                `INSERT INTO team_units
                 (config_id, key, display_name, color, prefix, suffix, friendly_fire, see_friendly_invisibles,
                  nametag_visibility, death_message_visibility, collision_rule, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [configId, u.key, u.display_name, u.color, u.prefix, u.suffix, u.friendly_fire,
                    u.see_friendly_invisibles, u.nametag_visibility, u.death_message_visibility,
                    u.collision_rule, u.sort_order]
            );
            for (const m of u.members) {
                await db.run('INSERT OR IGNORE INTO team_members (unit_id, player_name) VALUES (?, ?)', [ur.id, m]);
            }
        }
    });

    return configId;
}

/* ==================== ① 无认证公示读 ==================== */
router.get('/public', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM team_configs WHERE is_public = 1 ORDER BY updated_at DESC, id DESC');
        const configs = [];
        for (const row of rows) {
            configs.push(summarize(shapeConfig(row, await loadUnits(row.id)), true));
        }
        res.json({ count: configs.length, configs });
    } catch (e) {
        logger.error('获取队伍公示列表错误:', e);
        res.status(500).json({ error: '获取队伍公示失败' });
    }
});

router.get('/public/:id', async (req, res) => {
    try {
        const cfg = await loadConfig(parseInt(req.params.id));
        if (!cfg || !cfg.is_public) return res.status(404).json({ error: '队伍配置不存在或未公示' });
        res.json(cfg);
    } catch (e) {
        logger.error('获取队伍公示详情错误:', e);
        res.status(500).json({ error: '获取队伍公示失败' });
    }
});

/* ==================== ② 插件通道（X-Server-Key） ==================== */
router.get('/list', serverKeyAuth, async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM team_configs ORDER BY updated_at DESC, id DESC');
        const configs = [];
        for (const row of rows) {
            configs.push(summarize(shapeConfig(row, await loadUnits(row.id)), false));
        }
        res.json({ count: configs.length, configs });
    } catch (e) {
        logger.error('插件获取队伍列表错误:', e);
        res.status(500).json({ error: '获取队伍列表失败' });
    }
});

router.get('/export/:id', serverKeyAuth, async (req, res) => {
    try {
        const cfg = await loadConfig(parseInt(req.params.id));
        if (!cfg) return res.status(404).json({ error: '队伍配置不存在' });
        res.json(cfg);
    } catch (e) {
        logger.error('插件导出队伍配置错误:', e);
        res.status(500).json({ error: '导出队伍配置失败' });
    }
});

router.post('/import', serverKeyAuth, async (req, res) => {
    try {
        const body = { ...(req.body || {}) };
        if (!body.name) {
            const serverName = req.modServer && req.modServer.name ? req.modServer.name : '服务器';
            body.name = `现场采集 · ${serverName} · ${getLocalTimestamp().slice(0, 16)}`;
        }
        const v = validatePayload(body);
        if (!v.ok) return res.status(400).json({ error: v.error });

        const id = await saveConfig(v.data, { forcePrivate: true });
        const cfg = await loadConfig(id);
        logger.info(`队伍配置采集入库: id=${id} name=${cfg.name} units=${cfg.units.length}`);
        res.json({
            id,
            name: cfg.name,
            version: cfg.version,
            unit_count: cfg.units.length,
            member_count: cfg.units.reduce((n, u) => n + u.members.length, 0),
            message: '已保存为未公示草稿，可在管理页公示'
        });
    } catch (e) {
        logger.error('队伍配置采集入库错误:', e);
        res.status(500).json({ error: '采集入库失败' });
    }
});

/* ==================== ③ 管理写（JWT + 管理员） ==================== */
router.get('/configs', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM team_configs ORDER BY updated_at DESC, id DESC');
        const configs = [];
        for (const row of rows) {
            configs.push(summarize(shapeConfig(row, await loadUnits(row.id)), false));
        }
        res.json({ count: configs.length, configs });
    } catch (e) {
        logger.error('管理端获取队伍配置列表错误:', e);
        res.status(500).json({ error: '获取列表失败' });
    }
});

router.get('/configs/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const cfg = await loadConfig(parseInt(req.params.id));
        if (!cfg) return res.status(404).json({ error: '队伍配置不存在' });
        res.json(cfg);
    } catch (e) {
        logger.error('管理端获取队伍配置错误:', e);
        res.status(500).json({ error: '获取配置失败' });
    }
});

router.post('/configs', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const v = validatePayload(req.body);
        if (!v.ok) return res.status(400).json({ error: v.error });
        const id = await saveConfig(v.data, { createdBy: req.userId });
        logger.info(`新建队伍配置: id=${id} name=${v.data.name} by=${req.userId}`);
        res.json({ id, message: '创建成功' });
    } catch (e) {
        logger.error('新建队伍配置错误:', e);
        res.status(500).json({ error: '创建失败' });
    }
});

router.put('/configs/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const exists = await db.get('SELECT id FROM team_configs WHERE id = ?', [id]);
        if (!exists) return res.status(404).json({ error: '队伍配置不存在' });
        const v = validatePayload(req.body);
        if (!v.ok) return res.status(400).json({ error: v.error });
        await saveConfig(v.data, { id });
        logger.info(`更新队伍配置: id=${id} name=${v.data.name} by=${req.userId}`);
        res.json({ id, message: '保存成功' });
    } catch (e) {
        logger.error('更新队伍配置错误:', e);
        res.status(500).json({ error: '保存失败' });
    }
});

router.delete('/configs/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const exists = await db.get('SELECT id FROM team_configs WHERE id = ?', [id]);
        if (!exists) return res.status(404).json({ error: '队伍配置不存在' });
        await db.transaction(async () => {
            await db.run('DELETE FROM team_members WHERE unit_id IN (SELECT id FROM team_units WHERE config_id = ?)', [id]);
            await db.run('DELETE FROM team_units WHERE config_id = ?', [id]);
            await db.run('DELETE FROM team_configs WHERE id = ?', [id]);
        });
        logger.info(`删除队伍配置: id=${id} by=${req.userId}`);
        res.json({ message: '删除成功' });
    } catch (e) {
        logger.error('删除队伍配置错误:', e);
        res.status(500).json({ error: '删除失败' });
    }
});

module.exports = router;
