/**
 * 126 — GIS 初始数据（幂等种子）
 *
 * 1) 把集市已存在的 server_key（真实服务器）登记进 gis_servers（upload_policy='member'）；
 * 2) 为每个已注册服务器开一个 ACTIVE + is_current 的默认世界（world_key = `<server_key>-main`），
 *    并登记 overworld / nether / end 三个维度 —— 客户端 bootstrap 时据此拿到世界身份。
 *
 * 不删除、不覆盖管理员后来手工注册的世界；已存在则跳过（INSERT OR IGNORE + NOT EXISTS 判断）。
 */

module.exports = {
    id: 126,
    name: 'gis_seed',
    async up(db) {
        const localTs = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');

        const marketLoc = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='market_store_locations'`);
        if (marketLoc) {
            const rows = await db.all(`SELECT server_key, MAX(COALESCE(NULLIF(server_name,''), server_key)) AS server_name, COUNT(*) AS c
                                         FROM market_store_locations
                                        WHERE server_key IS NOT NULL AND TRIM(server_key) <> ''
                                        GROUP BY server_key`);
            for (const r of rows) {
                await db.run(
                    `INSERT OR IGNORE INTO gis_servers (server_key, server_name, upload_policy, status, description, created_at, updated_at)
                     VALUES (?, ?, 'member', 'ACTIVE', '由集市地点迁移登记', ?, ?)`,
                    [String(r.server_key), String(r.server_name || r.server_key), localTs(), localTs()]
                );
            }
        }

        const servers = await db.all(`SELECT server_key, server_name FROM gis_servers WHERE status = 'ACTIVE'`);
        for (const s of servers) {
            const worldKey = `${s.server_key}-main`;
            const exists = await db.get(`SELECT id FROM gis_worlds WHERE world_key = ?`, [worldKey]);
            let worldId;
            if (exists) {
                worldId = exists.id;
            } else {
                const hasCurrent = await db.get(
                    `SELECT id FROM gis_worlds WHERE server_key = ? AND status = 'ACTIVE' AND is_current = 1`, [s.server_key]);
                const r = await db.run(
                    `INSERT INTO gis_worlds (world_key, server_key, server_name, mc_version, status, is_current, description, created_at, updated_at)
                     VALUES (?, ?, ?, '', 'ACTIVE', ?, '默认世界（种子迁移创建，可在 GIS 管理台归档/改名）', ?, ?)`,
                    [worldKey, s.server_key, s.server_name || s.server_key, hasCurrent ? 0 : 1, localTs(), localTs()]
                );
                worldId = r.id;
            }
            for (const dim of ['overworld', 'nether', 'end']) {
                await db.run(
                    `INSERT OR IGNORE INTO gis_world_dimensions (world_id, dimension, created_at, updated_at)
                     VALUES (?, ?, ?, ?)`, [worldId, dim, localTs(), localTs()]
                );
            }
        }
    }
};
