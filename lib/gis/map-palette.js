/**
 * 玄剑 GIS 方块彩色地图调色板（服务端唯一配色来源，客户端只消费颜色）。
 *
 * 设计（见 docs/gis-canvas-map.md）：
 *  - 客户端上传的是「地表方块 hash16」（u16）；服务端不生成任何图片，只发颜色 → 浏览器 Canvas 绘制；
 *  - 本文件是配色**唯一维护点**：`lib/gis/block-colors.json` 覆盖全部 vanilla 方块（脚本生成：
 *    `node scripts/gis-gen-block-colors.js`），常用方块另有手工精修色（BLOCK_COLORS）。
 *
 * hash 约定（重要，兼容两套）：
 *  - **契约**：`CRC32("minecraft:grass_block") & 0xFFFF`（标准 IEEE CRC32，与 Java `CRC32` / zlib 一致）；
 *  - **兼容别名**：当前客户端实现实际输出 `CRC32("grass_block") & 0xFFFF`（不含命名空间）。
 *    为不让线上数据变灰，palette 对每个方块**同时登记**两种 hash（颜色相同）；
 *    模组侧建议后续统一为契约算法，别名保留亦无副作用。
 */

/* ---------------- CRC32（与客户端 / zlib.crc32 一致） ---------------- */

let CRC_TABLE = null;
function buildCrcTable() {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
}
/** 标准 CRC32 → 无符号整数 */
function crc32(str) {
    if (!CRC_TABLE) CRC_TABLE = buildCrcTable();
    const buf = Buffer.from(String(str), 'utf8');
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
}
/** 方块/群系资源名 → hash16（u16） */
function hash16(resourceName) {
    return crc32(resourceName) & 0xFFFF;
}

const PALETTE_VERSION = 2;

/* ---------------- 手工精修色（优先级最高，覆盖生成表） ---------------- */

const BLOCK_COLORS = [
    ['grass_block', '#7CBD4C'],
    ['grass_block_snow', '#E8F4F8'],
    ['podzol', '#6B4F2A'],
    ['mycelium', '#8C7B8B'],
    ['dirt', '#8B6A47'],
    ['coarse_dirt', '#7A5C3E'],
    ['rooted_dirt', '#9A7B57'],
    ['farmland', '#5A4027'],
    ['mud', '#3C3235'],
    ['clay', '#A0A7B4'],
    ['gravel', '#8E857C'],
    ['sand', '#E0D9A0'],
    ['red_sand', '#C1682F'],
    ['sandstone', '#D9CE8F'],
    ['red_sandstone', '#B45A28'],
    ['stone', '#8A8A8A'],
    ['cobblestone', '#6E6E6E'],
    ['mossy_cobblestone', '#6F7F5F'],
    ['smooth_stone', '#A0A0A0'],
    ['stone_bricks', '#7E7E7E'],
    ['mossy_stone_bricks', '#6E7E62'],
    ['bricks', '#9A5A48'],
    ['deepslate', '#4E4E52'],
    ['tuff', '#6C6C64'],
    ['calcite', '#DCDCD2'],
    ['andesite', '#8A8A8A'],
    ['diorite', '#C4C4C4'],
    ['granite', '#A27664'],
    ['basalt', '#4A4A52'],
    ['blackstone', '#3A3238'],
    ['netherrack', '#6B2626'],
    ['soul_sand', '#5A4636'],
    ['soul_soil', '#4B382C'],
    ['end_stone', '#DDE3A4'],
    ['bedrock', '#3A3A3A'],
    ['snow', '#F2F7FA'],
    ['snow_block', '#F2F7FA'],
    ['powder_snow', '#F5FAFF'],
    ['ice', '#A8C8E8'],
    ['packed_ice', '#93B8E0'],
    ['blue_ice', '#7AA6DC'],
    ['water', '#3C6ECC'],
    ['lava', '#D45A18'],
    ['oak_log', '#6B5333'],
    ['oak_planks', '#B08A4A'],
    ['oak_leaves', '#4F8424'],
    ['birch_log', '#D6D2C4'],
    ['birch_planks', '#D7C68A'],
    ['birch_leaves', '#6E9B3D'],
    ['spruce_log', '#4A3826'],
    ['spruce_planks', '#7A5B38'],
    ['spruce_leaves', '#3D6B33'],
    ['jungle_log', '#5C4A2A'],
    ['jungle_planks', '#B0875A'],
    ['jungle_leaves', '#3E8A2A'],
    ['acacia_log', '#5C4A3A'],
    ['acacia_planks', '#B0662E'],
    ['acacia_leaves', '#5A8A3A'],
    ['dark_oak_log', '#3E2C1A'],
    ['dark_oak_planks', '#4E3820'],
    ['dark_oak_leaves', '#2F6B2A'],
    ['mangrove_log', '#6A4A3A'],
    ['cherry_log', '#8A5A5A'],
    ['cherry_leaves', '#F0A8C8'],
    ['glass', '#C8E4F0'],
    ['glowstone', '#D8B45A'],
    ['sea_lantern', '#B8DCD0'],
    ['terracotta', '#9A5A44'],
    ['white_terracotta', '#D8C8B4'],
    ['hay_block', '#C8A03A'],
    ['melon', '#6A9A3A'],
    ['pumpkin', '#C07820'],
    ['nether_bricks', '#3A1E22'],
    ['quartz_block', '#E4E2DA'],
    ['iron_block', '#C8C8C8'],
    ['gold_block', '#E8C84A'],
    ['diamond_block', '#6AD8D0'],
    ['emerald_block', '#4AC85A'],
    ['amethyst_block', '#8A62C8'],
    ['copper_block', '#C07A50'],
    ['cut_copper', '#C07A50'],
    ['prismarine', '#6A9A8A'],
    ['dark_prismarine', '#3A6A5A'],
    ['sculk', '#1E2A32'],
    ['moss_block', '#5A7A32'],
    ['magma_block', '#8A3A1A'],
    ['crimson_nylium', '#7A1E2A'],
    ['warped_nylium', '#2A6A5A'],
    ['short_grass', '#7CBD4C'],
    ['coal_ore', '#5A5A5A'],
    ['iron_ore', '#8A7060'],
    ['copper_ore', '#8A7A66'],
    ['gold_ore', '#A89050'],
    ['diamond_ore', '#6A9A9A'],
    ['emerald_ore', '#4A8A5A'],
    ['redstone_ore', '#7A3A32'],
    ['lapis_ore', '#4A5A7A']
];

const WATER_BLOCKS = ['water', 'bubble_column', 'kelp', 'seagrass', 'tall_seagrass', 'ice'];

/** 无表面（空气类）：浏览器应画透明，而不是灰色 */
const TRANSPARENT_BLOCKS = ['air', 'cave_air', 'void_air', 'barrier', 'light', 'structure_void', 'bubble_column', 'moving_piston'];

/** 材质兜底（未知 hash 使用 unknown，必须是灰而非黑） */
const MATERIALS = {
    stone: '#8A8A8A',
    wood: '#B08A4A',
    leaves: '#4F8424',
    sand: '#E0D9A0',
    water: '#3C6ECC',
    snow: '#F2F7FA',
    built: '#9A8A7A',
    unknown: '#7A7A7A'
};

/** 高度兜底色带（旧数据只有 heights 时使用） */
const HEIGHT_RAMP = [
    { y: -64, color: '#1B2A4A' },
    { y: 40, color: '#2E5A7A' },
    { y: 50, color: '#3C6ECC' },
    { y: 62, color: '#D8CFA0' },
    { y: 70, color: '#7CBD4C' },
    { y: 90, color: '#4F8424' },
    { y: 120, color: '#8A8A8A' },
    { y: 180, color: '#C8C8C8' },
    { y: 320, color: '#F2F7FA' }
];

/** 常用群系（按资源名 hash + 常见数值 id 双键，兼容不同客户端） */
const BIOME_COLORS = [
    ['plains', 1, '#7CBD4C'], ['sunflower_plains', 2, '#8CCB5C'], ['snowy_plains', 3, '#E8F4F8'],
    ['desert', 4, '#E0D9A0'], ['swamp', 5, '#4A6B3A'], ['forest', 6, '#4F8424'],
    ['flower_forest', 7, '#5FA03A'], ['birch_forest', 8, '#7FA85A'], ['dark_forest', 9, '#2F6B2A'],
    ['old_growth_birch_forest', 10, '#86AE60'], ['taiga', 11, '#3D6B33'], ['snowy_taiga', 12, '#CFE4EC'],
    ['savanna', 13, '#B4A860'], ['jungle', 14, '#3E8A2A'], ['sparse_jungle', 15, '#5A9A3A'],
    ['badlands', 16, '#C1682F'], ['eroded_badlands', 17, '#B45A28'], ['beach', 18, '#E8DFA8'],
    ['snowy_beach', 19, '#EFF5F8'], ['stony_shore', 20, '#8E857C'], ['river', 21, '#3C6ECC'],
    ['frozen_river', 22, '#A8C8E8'], ['ocean', 23, '#2E5A7A'], ['deep_ocean', 24, '#1B2A4A'],
    ['warm_ocean', 25, '#2E6A9A'], ['lukewarm_ocean', 26, '#2E5A8A'], ['cold_ocean', 27, '#3A6A8A'],
    ['frozen_ocean', 28, '#A8C8E8'], ['mushroom_fields', 29, '#8C7B8B'], ['meadow', 30, '#7CBD4C'],
    ['grove', 31, '#CFE4EC'], ['snowy_slopes', 32, '#E8F4F8'], ['jagged_peaks', 33, '#C8C8C8'],
    ['frozen_peaks', 34, '#F2F7FA'], ['stony_peaks', 35, '#8A8A8A'], ['cherry_grove', 36, '#F0A8C8'],
    ['the_void', 37, '#20242A'], ['nether_wastes', 38, '#6B2626'], ['soul_sand_valley', 39, '#5A4636'],
    ['crimson_forest', 40, '#7A1E2A'], ['warped_forest', 41, '#2A6A5A'], ['basalt_deltas', 42, '#4A4A52'],
    ['the_end', 43, '#DDE3A4'], ['end_highlands', 44, '#D8DFA0'], ['end_midlands', 45, '#DDE3A4'],
    ['small_end_islands', 46, '#E0E6B0'], ['end_barrens', 47, '#D2D898']
];

/* ---------------- 载入生成的 vanilla 方块色表（path → color） ---------------- */

let GENERATED = {};
try {
    // eslint-disable-next-line import/no-dynamic-require
    GENERATED = require('./block-colors.json');
} catch (e) {
    GENERATED = {};
}

/** 构建对外调色板对象（惰性缓存） */
let cachedPalette = null;
function getPalette() {
    if (cachedPalette) return cachedPalette;
    const blocks = {};
    const blockNames = {};
    const transparent = {};
    const water = {};

    /** 同时登记「契约 hash」与「客户端当前 hash（无命名空间）」 */
    const addBlock = (name, color) => {
        const pathOnly = String(name).includes(':') ? String(name).split(':')[1] : String(name);
        const full = `minecraft:${pathOnly}`;
        const h1 = hash16(full);
        const h2 = hash16(pathOnly);
        blocks[h1] = color;
        blockNames[h1] = full;
        blocks[h2] = color;
        blockNames[h2] = `${full} (alias:path-only)`;
        return { h1, h2 };
    };

    // 1) 生成的完整 vanilla 色表
    for (const [name, color] of Object.entries(GENERATED)) addBlock(name, color);
    // 2) 手工精修色覆盖
    for (const [name, color] of BLOCK_COLORS) addBlock(name, color);
    // 3) 透明方块（空气类）
    for (const name of TRANSPARENT_BLOCKS) {
        const { h1, h2 } = addBlock(name, MATERIALS.unknown);
        transparent[h1] = true;
        transparent[h2] = true;
    }
    // 4) 水面标记
    for (const name of WATER_BLOCKS) {
        const { h1, h2 } = addBlock(name, MATERIALS.water);
        water[h1] = true;
        water[h2] = true;
    }

    const biomes = {};
    for (const [name, id, color] of BIOME_COLORS) {
        biomes[String(id)] = color;
        biomes[String(hash16(`minecraft:${name}`))] = color;
        biomes[String(hash16(name))] = color;
    }

    cachedPalette = {
        version: PALETTE_VERSION,
        blocks,
        water,
        transparent,
        materials: MATERIALS,
        heightShade: { minY: -64, maxY: 320, ramp: HEIGHT_RAMP },
        biomes,
        blockNames,
        hashConventions: {
            primary: 'CRC32("minecraft:<block>") & 0xFFFF（契约）',
            aliases: ['CRC32("<block>") & 0xFFFF（当前客户端实际输出，兼容登记）'],
            crc32: '标准 IEEE CRC32（Java java.util.zip.CRC32 / Node zlib.crc32 一致）',
            selfCheck: 'CRC32("123456789") = 0xCBF43926；CRC32("minecraft:grass_block") = 1430378039 → hash16 = 54839'
        },
        stats: { blockColors: Object.keys(GENERATED).length, paletteBlocks: Object.keys(blocks).length },
        note: '客户端只消费颜色，不硬编码；未知 hash 用 materials.unknown（灰，非黑）'
    };
    return cachedPalette;
}

/** 判断某 hash 是否已登记颜色（用于诊断接口） */
function isKnownHash(hash) {
    const p = getPalette();
    return Object.prototype.hasOwnProperty.call(p.blocks, String(hash));
}

module.exports = {
    PALETTE_VERSION, crc32, hash16, getPalette, isKnownHash,
    BLOCK_COLORS, BIOME_COLORS, MATERIALS, HEIGHT_RAMP, WATER_BLOCKS, TRANSPARENT_BLOCKS
};
