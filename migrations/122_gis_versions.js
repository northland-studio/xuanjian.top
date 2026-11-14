/**
 * 122 — GIS 版本、发布层与审核日志
 *
 * 三层结构：
 *   工作副本  gis_districts / gis_roads / gis_markers   （可编辑，含 DRAFT/REVIEW）
 *   版本历史  gis_revisions                              （不可变，每次正式修改一条快照）
 *   发布层    gis_published                              （只有 PUBLISHED Revision，客户端只读这一层）
 *
 * 客户端只同步 gis_published，并靠单调递增的 seq 做增量游标（gis_seq.published）。
 * 历史数据永不覆盖当前数据：回滚 = 用旧快照生成新版本 N+1。
 *
 * 幂等：CREATE TABLE / INDEX IF NOT EXISTS。
 */

module.exports = {
    id: 122,
    name: 'gis_versions',
    async up(db) {
        await db.run(`CREATE TABLE IF NOT EXISTS gis_revisions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            object_type TEXT NOT NULL CHECK (object_type IN ('district','road','marker')),
            object_id   INTEGER NOT NULL,
            world_id    INTEGER NOT NULL,
            dimension   TEXT NOT NULL,
            revision    INTEGER NOT NULL,
            status      TEXT NOT NULL,
            action      TEXT NOT NULL,
            actor_id    INTEGER,
            note        TEXT DEFAULT '',
            snapshot    TEXT NOT NULL,
            min_x       REAL, max_x REAL, min_z REAL, max_z REAL,
            created_at  TEXT NOT NULL,
            UNIQUE(object_type, object_id, revision)
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_rev_obj
            ON gis_revisions(object_type, object_id, revision DESC)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_rev_world_time
            ON gis_revisions(world_id, dimension, created_at)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_rev_status
            ON gis_revisions(status, created_at)`);

        await db.run(`CREATE TABLE IF NOT EXISTS gis_published (
            object_type TEXT NOT NULL CHECK (object_type IN ('district','road','marker')),
            object_id   INTEGER NOT NULL,
            world_id    INTEGER NOT NULL,
            dimension   TEXT NOT NULL,
            revision    INTEGER NOT NULL,
            seq         INTEGER NOT NULL,
            payload     TEXT NOT NULL,
            min_x       REAL NOT NULL, max_x REAL NOT NULL,
            min_z       REAL NOT NULL, max_z REAL NOT NULL,
            deleted     INTEGER NOT NULL DEFAULT 0,
            updated_at  TEXT NOT NULL,
            PRIMARY KEY (object_type, object_id)
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_pub_bbox
            ON gis_published(world_id, dimension, deleted, min_x, max_x)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_pub_seq
            ON gis_published(world_id, dimension, seq)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_pub_type
            ON gis_published(world_id, dimension, object_type, deleted)`);

        await db.run(`CREATE TABLE IF NOT EXISTS gis_review_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            object_type TEXT NOT NULL,
            object_id   INTEGER NOT NULL,
            action      TEXT NOT NULL,
            actor_id    INTEGER,
            from_status TEXT,
            to_status   TEXT,
            note        TEXT DEFAULT '',
            created_at  TEXT NOT NULL
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_review_log_obj
            ON gis_review_log(object_type, object_id, id DESC)`);
    }
};
