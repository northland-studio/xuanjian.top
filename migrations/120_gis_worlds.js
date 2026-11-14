/**
 * 120 — GIS World Registry（世界注册与数据隔离）
 *
 * 原则：
 *  - 世界只能由管理员注册，客户端不能创建世界；
 *  - 每个世界绑定唯一 serverKey，未注册服务器的数据不得上传；
 *  - 世界状态 ACTIVE / ARCHIVED / SNAPSHOT，同一 serverKey 只有一个是 is_current。
 *
 * 幂等：全部 CREATE TABLE / INDEX IF NOT EXISTS，可重复执行。
 * 由 migrations/run.js 调用：module.exports = { id, name, up(db) }
 */

module.exports = {
    id: 120,
    name: 'gis_worlds',
    async up(db) {
        // 服务器注册表：服务器 ↔ GIS 世界的绑定方
        await db.run(`CREATE TABLE IF NOT EXISTS gis_servers (
            server_key      TEXT PRIMARY KEY,
            server_name     TEXT NOT NULL DEFAULT '',
            mc_version      TEXT DEFAULT '',
            upload_policy   TEXT NOT NULL DEFAULT 'member'
                            CHECK (upload_policy IN ('member','token','closed')),
            upload_token_hash TEXT,
            status          TEXT NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE','DISABLED')),
            description     TEXT DEFAULT '',
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT (datetime('now','localtime'))
        )`);

        // 世界注册表
        await db.run(`CREATE TABLE IF NOT EXISTS gis_worlds (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            world_key       TEXT NOT NULL UNIQUE,
            server_key      TEXT NOT NULL,
            server_name     TEXT DEFAULT '',
            mc_version      TEXT DEFAULT '',
            status          TEXT NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE','ARCHIVED','SNAPSHOT')),
            is_current      INTEGER NOT NULL DEFAULT 0,
            description     TEXT DEFAULT '',
            created_by      INTEGER,
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT (datetime('now','localtime'))
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_worlds_server
            ON gis_worlds(server_key, status, is_current)`);

        // 世界维度（每个世界可多个维度，记录已采集范围）
        await db.run(`CREATE TABLE IF NOT EXISTS gis_world_dimensions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id        INTEGER NOT NULL,
            dimension       TEXT NOT NULL
                            CHECK (dimension IN ('overworld','nether','end','custom')),
            chunk_count     INTEGER NOT NULL DEFAULT 0,
            min_x           REAL,
            max_x           REAL,
            min_z           REAL,
            max_z           REAL,
            created_at      TEXT DEFAULT (datetime('now','localtime')),
            updated_at      TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(world_id, dimension)
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_world_dims
            ON gis_world_dimensions(world_id)`);

        // 客户端上传批次（幂等键 + 审计）
        await db.run(`CREATE TABLE IF NOT EXISTS gis_upload_batches (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            idempotency_key     TEXT NOT NULL UNIQUE,
            world_id            INTEGER NOT NULL,
            dimension           TEXT NOT NULL,
            contributor_id      INTEGER,
            client_contract     INTEGER,
            chunk_count         INTEGER NOT NULL DEFAULT 0,
            compressed_bytes    INTEGER NOT NULL DEFAULT 0,
            decompressed_bytes  INTEGER NOT NULL DEFAULT 0,
            encoding            TEXT DEFAULT '',
            status              TEXT NOT NULL DEFAULT 'OK',
            response            TEXT,
            created_at          TEXT DEFAULT (datetime('now','localtime'))
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_batches_user
            ON gis_upload_batches(contributor_id, created_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_batches_world
            ON gis_upload_batches(world_id, dimension, created_at)`);

        // 单调递增序号（客户端增量同步游标依赖它，禁止回退）
        await db.run(`CREATE TABLE IF NOT EXISTS gis_seq (
            name    TEXT PRIMARY KEY,
            value   INTEGER NOT NULL DEFAULT 0
        )`);
        await db.run(`INSERT OR IGNORE INTO gis_seq(name, value) VALUES ('published', 0)`);

        // 安全审计（写接口、上传、权限拒绝）
        await db.run(`CREATE TABLE IF NOT EXISTS gis_audit (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            event       TEXT NOT NULL,
            actor_id    INTEGER,
            world_id    INTEGER,
            object_type TEXT,
            object_id   INTEGER,
            ip          TEXT,
            detail      TEXT,
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_audit_time
            ON gis_audit(created_at)`);
    }
};
