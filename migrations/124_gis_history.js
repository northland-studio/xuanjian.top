/**
 * 124 — 历史地图：世界快照 + 快照条目
 *
 * 快照不复制几何（避免 2G 内存/39G 盘压力），只记录「对象 → 当时已发布版本号」，
 * 历史视图通过 gis_revisions 重建；当前数据不被历史数据覆盖。
 *
 * 幂等：CREATE TABLE / INDEX IF NOT EXISTS。
 */

module.exports = {
    id: 124,
    name: 'gis_history',
    async up(db) {
        await db.run(`CREATE TABLE IF NOT EXISTS gis_snapshots (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id        INTEGER NOT NULL,
            name            TEXT NOT NULL,
            note            TEXT DEFAULT '',
            scope           TEXT NOT NULL DEFAULT 'world'
                            CHECK (scope IN ('world','dimension')),
            dimension       TEXT,
            object_count    INTEGER NOT NULL DEFAULT 0,
            captured_at     TEXT NOT NULL,
            created_by      INTEGER,
            created_at      TEXT DEFAULT (datetime('now','localtime'))
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_snapshots_world
            ON gis_snapshots(world_id, captured_at)`);

        await db.run(`CREATE TABLE IF NOT EXISTS gis_snapshot_entries (
            snapshot_id INTEGER NOT NULL,
            object_type TEXT NOT NULL,
            object_id   INTEGER NOT NULL,
            revision    INTEGER NOT NULL,
            PRIMARY KEY(snapshot_id, object_type, object_id)
        )`);
    }
};
