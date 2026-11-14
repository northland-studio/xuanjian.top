/**
 * 121 — GIS 核心对象：District（城区）/ Road（道路）/ Marker（地点标记）
 *
 * 几何统一存 GeoJSON 文本（Point / LineString / Polygon / MultiPolygon），
 * 同时把包围盒冗余成 min_x/max_x/min_z/max_z 供 SQLite 做「空间索引」——
 * 按 bbox 的可见区域查询走 (world_id, dimension, min_x) 索引，严禁整世界扫描。
 *
 * 状态机：DRAFT → REVIEW → PUBLISHED → Version N+1，REJECTED / ARCHIVED。
 * 每行 = 当前工作副本（可编辑）；对外只暴露 gis_published 中的已发布版本（见 122）。
 *
 * 幂等：CREATE TABLE / INDEX IF NOT EXISTS。
 */

module.exports = {
    id: 121,
    name: 'gis_objects',
    async up(db) {
        await db.run(`CREATE TABLE IF NOT EXISTS gis_districts (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id            INTEGER NOT NULL,
            dimension           TEXT NOT NULL DEFAULT 'overworld'
                                CHECK (dimension IN ('overworld','nether','end','custom')),
            name                TEXT NOT NULL,
            district_type       TEXT NOT NULL DEFAULT 'district',
            parent_id           INTEGER,
            geometry            TEXT NOT NULL,
            geometry_type       TEXT NOT NULL DEFAULT 'Polygon',
            min_x               REAL NOT NULL, max_x REAL NOT NULL,
            min_z               REAL NOT NULL, max_z REAL NOT NULL,
            style_color         TEXT DEFAULT '#5b8def',
            style_opacity       REAL DEFAULT 0.25,
            style_weight        INTEGER DEFAULT 2,
            description         TEXT DEFAULT '',
            wiki_page_id        INTEGER,
            status              TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT','REVIEW','PUBLISHED','REJECTED','ARCHIVED')),
            revision            INTEGER NOT NULL DEFAULT 1,
            published_revision  INTEGER NOT NULL DEFAULT 0,
            created_by          INTEGER,
            updated_by          INTEGER,
            reviewed_by         INTEGER,
            review_note         TEXT DEFAULT '',
            created_at          TEXT DEFAULT (datetime('now','localtime')),
            updated_at          TEXT DEFAULT (datetime('now','localtime')),
            published_at        TEXT,
            archived_at         TEXT
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_districts_bbox
            ON gis_districts(world_id, dimension, status, min_x, max_x)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_districts_parent
            ON gis_districts(parent_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_districts_wiki
            ON gis_districts(wiki_page_id)`);

        await db.run(`CREATE TABLE IF NOT EXISTS gis_roads (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id            INTEGER NOT NULL,
            dimension           TEXT NOT NULL DEFAULT 'overworld'
                                CHECK (dimension IN ('overworld','nether','end','custom')),
            name                TEXT NOT NULL,
            road_type           TEXT NOT NULL DEFAULT 'road',
            geometry            TEXT NOT NULL,
            geometry_type       TEXT NOT NULL DEFAULT 'LineString',
            min_x               REAL NOT NULL, max_x REAL NOT NULL,
            min_z               REAL NOT NULL, max_z REAL NOT NULL,
            width               REAL NOT NULL DEFAULT 5,
            road_level          INTEGER NOT NULL DEFAULT 3,
            is_main             INTEGER NOT NULL DEFAULT 0,
            district_id         INTEGER,
            description         TEXT DEFAULT '',
            wiki_page_id        INTEGER,
            status              TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT','REVIEW','PUBLISHED','REJECTED','ARCHIVED')),
            revision            INTEGER NOT NULL DEFAULT 1,
            published_revision  INTEGER NOT NULL DEFAULT 0,
            created_by          INTEGER,
            updated_by          INTEGER,
            reviewed_by         INTEGER,
            review_note         TEXT DEFAULT '',
            created_at          TEXT DEFAULT (datetime('now','localtime')),
            updated_at          TEXT DEFAULT (datetime('now','localtime')),
            published_at        TEXT,
            archived_at         TEXT
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_roads_bbox
            ON gis_roads(world_id, dimension, status, min_x, max_x)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_roads_district
            ON gis_roads(district_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_roads_wiki
            ON gis_roads(wiki_page_id)`);

        await db.run(`CREATE TABLE IF NOT EXISTS gis_markers (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id            INTEGER NOT NULL,
            dimension           TEXT NOT NULL DEFAULT 'overworld'
                                CHECK (dimension IN ('overworld','nether','end','custom')),
            name                TEXT NOT NULL,
            category            TEXT NOT NULL DEFAULT 'other'
                                CHECK (category IN ('public_building','housing','shop','industry',
                                                    'agriculture','transport','entertainment','government','other')),
            x                   REAL NOT NULL,
            y                   REAL NOT NULL DEFAULT 64,
            z                   REAL NOT NULL,
            min_x               REAL NOT NULL, max_x REAL NOT NULL,
            min_z               REAL NOT NULL, max_z REAL NOT NULL,
            description         TEXT DEFAULT '',
            wiki_page_id        INTEGER,
            status              TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT','REVIEW','PUBLISHED','REJECTED','ARCHIVED')),
            revision            INTEGER NOT NULL DEFAULT 1,
            published_revision  INTEGER NOT NULL DEFAULT 0,
            submitter_id        INTEGER,
            created_by          INTEGER,
            updated_by          INTEGER,
            reviewed_by         INTEGER,
            review_note         TEXT DEFAULT '',
            created_at          TEXT DEFAULT (datetime('now','localtime')),
            updated_at          TEXT DEFAULT (datetime('now','localtime')),
            published_at        TEXT,
            archived_at         TEXT
        )`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_markers_bbox
            ON gis_markers(world_id, dimension, status, min_x, max_x)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_markers_cat
            ON gis_markers(world_id, dimension, category, status)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_markers_wiki
            ON gis_markers(wiki_page_id)`);
        await db.run(`CREATE INDEX IF NOT EXISTS idx_gis_markers_submitter
            ON gis_markers(submitter_id)`);
    }
};
