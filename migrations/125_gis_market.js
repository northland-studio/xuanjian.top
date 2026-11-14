/**
 * 125 — 集市地点与 GIS 的空间关联（增量、非破坏）
 *
 * 硬性约束（规范第十七条）：
 *  - 集市仍然使用 market_store_locations 作为唯一地点数据源，不新建并行地点系统；
 *  - 不迁移、不删除、不重写任何旧地点数据（兼容读取，数量与 id 保持不变）；
 *  - 只追加可空列做「可选关联」，商品/店铺/订单/托管/退款/结算逻辑零改动；
 *  - 预留 XBed 的 GIS 地点引用表（只增表，不改 xbed 仓库）。
 *
 * 幂等：PRAGMA table_info 判断后 ALTER；CREATE TABLE / INDEX IF NOT EXISTS。
 */

const hasColumn = async (db, table, column) => {
    try {
        const cols = await db.all(`PRAGMA table_info(${table})`);
        return Array.isArray(cols) && cols.some(c => c && String(c.name) === column);
    } catch (e) {
        return false;
    }
};

const hasTable = async (db, table) => {
    try {
        const row = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [table]);
        return !!row;
    } catch (e) {
        return false;
    }
};

module.exports = {
    id: 125,
    name: 'gis_market_links',
    async up(db) {
        if (await hasTable(db, 'market_store_locations')) {
            if (!(await hasColumn(db, 'market_store_locations', 'world_id'))) {
                await db.run(`ALTER TABLE market_store_locations ADD COLUMN world_id INTEGER`);
            }
            if (!(await hasColumn(db, 'market_store_locations', 'gis_marker_id'))) {
                await db.run(`ALTER TABLE market_store_locations ADD COLUMN gis_marker_id INTEGER`);
            }
            // 地图按 bbox 读取集市地点时的空间索引（server_key/dimension 已有索引，这里补坐标）
            await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_market_loc_xyz
                ON market_store_locations(server_key, dimension, x, z)`);
            if (!(await hasColumn(db, 'market_store_locations', 'world_id'))) {
                throw new Error('migration 125: market_store_locations.world_id 添加失败');
            }
        }

        // XBed 预留：外部系统（xbed 等）对 GIS 地点的引用
        await db.run(`CREATE TABLE IF NOT EXISTS gis_place_refs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            external_system TEXT NOT NULL,
            external_id     TEXT NOT NULL,
            ref_kind        TEXT NOT NULL
                            CHECK (ref_kind IN ('marker','district','road','point','market_store')),
            ref_id          INTEGER,
            world_id        INTEGER,
            dimension       TEXT,
            x               REAL,
            y               REAL,
            z               REAL,
            label           TEXT DEFAULT '',
            note            TEXT DEFAULT '',
            created_by      INTEGER,
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(external_system, external_id)
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_place_refs_ext
            ON gis_place_refs(external_system, external_id)`);
    }
};
