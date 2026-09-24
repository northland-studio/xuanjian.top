/**
 * 队伍信息采集公示系统 · 数据表迁移 + 公开测试样例数据
 *
 * 三张表：
 *   team_configs  一场活动的队伍配置（队伍集合）
 *   team_units    配置里的单个队伍单元（黄队/红队…）
 *   team_members  队伍成员（以游戏 ID / 离线模式玩家名为准）
 *
 * 运行：node scripts/migrate-team.js
 * 幂等：可重复执行（IF NOT EXISTS + 样例数据按名称去重）
 */
const db = require('../database');
const { getLocalTimestamp } = require('../database');

const COLORS = ['black', 'dark_blue', 'dark_green', 'dark_aqua', 'dark_red', 'dark_purple', 'gold',
    'gray', 'dark_gray', 'blue', 'green', 'aqua', 'red', 'light_purple', 'yellow', 'white'];

async function createTables() {
    await db.run(`
        CREATE TABLE IF NOT EXISTS team_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            event_date TEXT DEFAULT NULL,
            is_public INTEGER NOT NULL DEFAULT 0,
            scoreboard_enabled INTEGER NOT NULL DEFAULT 0,
            scoreboard_objective TEXT NOT NULL DEFAULT 'nt_teams',
            scoreboard_display_name TEXT NOT NULL DEFAULT '<gold>队伍</gold>',
            scoreboard_position TEXT NOT NULL DEFAULT 'sidebar',
            scoreboard_score_mode TEXT NOT NULL DEFAULT 'member_count',
            created_by INTEGER DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS team_units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            config_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            display_name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT 'white',
            prefix TEXT NOT NULL DEFAULT '',
            suffix TEXT NOT NULL DEFAULT '',
            friendly_fire INTEGER NOT NULL DEFAULT 0,
            see_friendly_invisibles INTEGER NOT NULL DEFAULT 1,
            nametag_visibility TEXT NOT NULL DEFAULT 'always',
            death_message_visibility TEXT NOT NULL DEFAULT 'always',
            collision_rule TEXT NOT NULL DEFAULT 'always',
            sort_order INTEGER NOT NULL DEFAULT 0,
            UNIQUE (config_id, key)
        )
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            unit_id INTEGER NOT NULL,
            player_name TEXT NOT NULL,
            UNIQUE (unit_id, player_name)
        )
    `);
    await db.run('CREATE INDEX IF NOT EXISTS idx_team_units_config ON team_units (config_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_team_members_unit ON team_members (unit_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_team_configs_public ON team_configs (is_public)');
    console.log('[完成] 三张队伍表已就绪');
}

/** 公开测试样例：CI/插件联调直接从这里拉数据（is_public=1 无认证可读） */
async function seedSample() {
    const SAMPLE = 'CI 测试用例 · 周年庆大逃杀';
    const exists = await db.get('SELECT id FROM team_configs WHERE name = ?', [SAMPLE]);
    if (exists) {
        console.log(`[跳过] 样例配置已存在（id=${exists.id}）`);
        return exists.id;
    }

    const now = getLocalTimestamp();
    const cfg = await db.run(
        `INSERT INTO team_configs
         (name, description, event_date, is_public, scoreboard_enabled, scoreboard_objective,
          scoreboard_display_name, scoreboard_position, scoreboard_score_mode, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 1, 1, 'nt_teams', '<gold>队伍</gold>', 'sidebar', 'member_count', NULL, ?, ?)`,
        [SAMPLE, '供 NorthTeam 插件与 CI 联调使用的公开样例：四队、含前缀与全部规则字段、开启侧边栏同步。', null, now, now]
    );
    const configId = cfg.id;

    // key / 显示名 / 颜色 / 前缀 / 规则 / 成员
    const units = [
        {
            key: 'yellow', display_name: '黄队', color: 'yellow', prefix: '<yellow>[黄]</yellow> ', suffix: '',
            friendly_fire: 0, see_friendly_invisibles: 1, nametag: 'always', death: 'always', collision: 'always',
            members: ['Morzane123', 'brichir', 'NT_CI_Yellow1', 'NT_CI_Yellow2']
        },
        {
            key: 'red', display_name: '红队', color: 'red', prefix: '<red>[红]</red> ', suffix: '',
            friendly_fire: 0, see_friendly_invisibles: 1, nametag: 'always', death: 'always', collision: 'always',
            members: ['NT_CI_Red1', 'NT_CI_Red2', 'NT_CI_Red3', 'NT_CI_Red4']
        },
        {
            key: 'blue', display_name: '蓝队', color: 'blue', prefix: '<blue>[蓝]</blue> ', suffix: '',
            friendly_fire: 1, see_friendly_invisibles: 0, nametag: 'hideForOtherTeams', death: 'always', collision: 'pushOtherTeams',
            members: ['NT_CI_Blue1', 'NT_CI_Blue2']
        },
        {
            key: 'green', display_name: '绿队', color: 'green', prefix: '<green>[绿]</green> ', suffix: ' <gray>·新人</gray>',
            friendly_fire: 0, see_friendly_invisibles: 1, nametag: 'always', death: 'hideForOtherTeams', collision: 'never',
            members: ['NT_CI_Green1']
        }
    ];

    let order = 1;
    for (const u of units) {
        const r = await db.run(
            `INSERT INTO team_units
             (config_id, key, display_name, color, prefix, suffix, friendly_fire, see_friendly_invisibles,
              nametag_visibility, death_message_visibility, collision_rule, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [configId, u.key, u.display_name, u.color, u.prefix, u.suffix, u.friendly_fire,
                u.see_friendly_invisibles, u.nametag, u.death, u.collision, order++]
        );
        for (const m of u.members) {
            await db.run('INSERT OR IGNORE INTO team_members (unit_id, player_name) VALUES (?, ?)', [r.id, m]);
        }
    }
    console.log(`[完成] 已写入公开样例配置「${SAMPLE}」(id=${configId})，共 ${units.length} 个队伍`);
    console.log('        插件侧可直接 /nt list 看到它，/nt apply ' + configId + ' 应用');
    return configId;
}

async function main() {
    console.log('=== 队伍信息采集公示系统 · 迁移 ===');
    console.log('颜色枚举:', COLORS.join(', '));
    await createTables();
    await seedSample();
    const c = await db.get('SELECT COUNT(*) AS n FROM team_configs');
    const u = await db.get('SELECT COUNT(*) AS n FROM team_units');
    const m = await db.get('SELECT COUNT(*) AS n FROM team_members');
    console.log(`[统计] 配置 ${c.n} 条 / 队伍 ${u.n} 个 / 成员 ${m.n} 人`);
    process.exit(0);
}

main().catch(e => {
    console.error('[失败]', e);
    process.exit(1);
});
