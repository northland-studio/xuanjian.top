/**
 * 123 — 地形数据：真实高程栅格 chunk、等高线缓存、异步任务
 *
 * 高程只来自客户端上传的真实区块采样（见 docs/gis-api.md 二进制协议）。
 * 未采集区域用 NULL/缺口表示（heights 中 -32768 = 该采样点无数据），
 * 绝不用 0 或平均高度伪造平地。
 *
 * 幂等：CREATE TABLE / INDEX IF NOT EXISTS。
 */

module.exports = {
    id: 123,
    name: 'gis_terrain',
    async up(db) {
        await db.run(`CREATE TABLE IF NOT EXISTS gis_elevation_chunks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id        INTEGER NOT NULL,
            dimension       TEXT NOT NULL
                            CHECK (dimension IN ('overworld','nether','end','custom')),
            chunk_x         INTEGER NOT NULL,
            chunk_z         INTEGER NOT NULL,
            sample_step     INTEGER NOT NULL DEFAULT 1,
            sample_size     INTEGER NOT NULL DEFAULT 16,
            min_y           INTEGER,
            max_y           INTEGER,
            heights         BLOB NOT NULL,
            biome           BLOB,
            block_hist      TEXT,
            has_gaps        INTEGER NOT NULL DEFAULT 0,
            contributor_id  INTEGER,
            batch_id        INTEGER,
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(world_id, dimension, chunk_x, chunk_z)
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_elev_lookup
            ON gis_elevation_chunks(world_id, dimension, chunk_x, chunk_z)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_elev_time
            ON gis_elevation_chunks(world_id, dimension, updated_at)`);

        // 等高线/地形分析结果缓存（服务端缓存属"展示产物"，权威数据仍是 gis_elevation_chunks）
        await db.run(`CREATE TABLE IF NOT EXISTS gis_terrain_cache (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_key       TEXT NOT NULL UNIQUE,
            kind            TEXT NOT NULL,
            world_id        INTEGER NOT NULL,
            dimension       TEXT NOT NULL,
            payload         TEXT NOT NULL,
            data_signature  TEXT,
            created_at      TEXT DEFAULT (datetime('now','localtime'))
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_terrain_cache_kind
            ON gis_terrain_cache(kind, world_id, dimension, created_at)`);

        await db.run(`CREATE TABLE IF NOT EXISTS gis_jobs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kind        TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','RUNNING','DONE','FAILED','CANCELLED')),
            world_id    INTEGER,
            dimension   TEXT,
            params      TEXT NOT NULL DEFAULT '{}',
            progress    REAL NOT NULL DEFAULT 0,
            result      TEXT,
            error       TEXT,
            created_by  INTEGER,
            created_at  TEXT DEFAULT (datetime('now','localtime')),
            started_at  TEXT,
            finished_at TEXT
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_jobs_status
            ON gis_jobs(status, id)`);
    }
};
