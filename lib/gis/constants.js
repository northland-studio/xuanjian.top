/**
 * GIS 共享常量与限额。
 * 任何新的枚举/上限都放这里，路由与 lib 共用，避免前后端漂移。
 */

const CONTRACT_VERSION = 1;

const DIMENSIONS = ['overworld', 'nether', 'end', 'custom'];
const DIMENSION_LABEL = { overworld: '主世界', nether: '下界', end: '末地', custom: '自定义' };
const DIMENSION_CODE = { overworld: 0, nether: 1, end: 2, custom: 3 };
const DIMENSION_FROM_CODE = ['overworld', 'nether', 'end', 'custom'];

const WORLD_STATUS = ['ACTIVE', 'ARCHIVED', 'SNAPSHOT'];
const OBJECT_STATUS = ['DRAFT', 'REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED'];
const OBJECT_TYPES = ['district', 'road', 'marker'];
const GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon', 'MultiPolygon'];

const MARKER_CATEGORIES = [
    'public_building', 'housing', 'shop', 'industry',
    'agriculture', 'transport', 'entertainment', 'government', 'other'
];
const MARKER_CATEGORY_LABEL = {
    public_building: '公共建筑', housing: '住宅', shop: '商铺', industry: '工业',
    agriculture: '农业', transport: '交通', entertainment: '娱乐', government: '政府/组织', other: '其他'
};

const DISTRICT_TYPES = ['city', 'district', 'zone', 'region', 'other'];
const ROAD_TYPES = ['road', 'street', 'path', 'highway', 'bridge', 'tunnel', 'other'];

const CONTOUR_INTERVALS = [5, 10, 20, 50, 100];

const LIMITS = {
    // 每页对象数
    objectsPageDefault: 200,
    objectsPageMax: 1000,
    // bbox 面积上限（方块²）：约 4000 × 4000，防止整世界拉取
    maxBboxArea: 16000000,
    // 地形同步计算 bbox 面积上限（方块²）：512 × 512
    terrainSyncBboxArea: 512 * 512,
    // 统计类接口 bbox 面积上限：4000 × 4000
    terrainStatsBboxArea: 16000000,
    // 地形网格采样点数上限
    terrainMaxSamples: 262144,
    // 客户端单批上传
    maxChunkBatch: 64,
    maxCompressedBytes: 4 * 1024 * 1024,
    maxDecompressedBytes: 8 * 1024 * 1024,
    maxSampleSize: 32,
    chunkBlocks: 16,
    // 客户端上传限流
    uploadRatePerMinute: 60,
    planChunksMax: 4096,
    // 几何上限
    maxGeometryPoints: 20000,
    maxGeometryBytes: 2 * 1024 * 1024,
    maxNameLength: 60,
    maxDescLength: 2000,
    maxNoteLength: 500,
    // 等高线返回上限（防 JSON 爆炸）
    maxContourSegments: 6000,
    maxContourPoints: 40000,
    // 服务端等高线缓存条数
    contourCacheEntries: 96,
    // 方块彩色地图（浏览器端渲染，服务端只出数据）
    mapMaxBboxArea: 4000000,
    mapMaxChunks: 512,
    mapMaxLod: 6
};

const ACTIONS = ['create', 'update', 'submit', 'publish', 'reject', 'rollback', 'archive', 'wiki'];

const PERMISSIONS = {
    access: 'gis.access',
    submit: 'gis.submit',
    roadEdit: 'gis.road.edit',
    districtEdit: 'gis.district.edit',
    review: 'gis.object.review',
    admin: 'gis.admin'
};

module.exports = {
    CONTRACT_VERSION,
    DIMENSIONS, DIMENSION_LABEL, DIMENSION_CODE, DIMENSION_FROM_CODE,
    WORLD_STATUS, OBJECT_STATUS, OBJECT_TYPES, GEOMETRY_TYPES,
    MARKER_CATEGORIES, MARKER_CATEGORY_LABEL, DISTRICT_TYPES, ROAD_TYPES,
    CONTOUR_INTERVALS, LIMITS, ACTIONS, PERMISSIONS
};
