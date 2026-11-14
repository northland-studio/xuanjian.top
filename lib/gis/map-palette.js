/**
 * 玄剑 GIS 方块彩色地图调色板（服务端唯一配色来源，客户端只消费颜色）。
 *
 * 设计（见 docs/gis-canvas-map.md）：
 *  - 客户端上传的是「地表方块 ID」= CRC32(minecraft 资源名) & 0xFFFF（u16）；
 *  - 服务端不生成任何图片，只把 hash16 → 颜色 / 水面标记 / 材质兜底色 / 群系兜底色 发给浏览器，
 *    由浏览器端 Canvas 实时绘制；
 *  - 本文件是配色的**唯一维护点**：新增方块/群系只改这里，前后端无需发版对齐。
 *
 * 注意：CRC32 必须与客户端一致（标准 IEEE CRC32，与 zlib.crc32 相同），这里自带实现避免 Node 版本差异。
 */

const PALETTE_VERSION = 1;

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
/** 方块/群系资源名 → hash16（u16，与客户端上传值一致） */
function hash16(resourceName) {
    return crc32(resourceName) & 0xFFFF;
}

/* ---------------- 方块配色（地表常见方块，按资源名维护） ---------------- */

// [资源名, 颜色]；颜色为大致可辨识的方块平均色
const BLOCK_COLORS = [
    ['minecraft:grass_block', '#7CBD4C'],
    ['minecraft:grass_block_snow', '#E8F4F8'],
    ['minecraft:podzol', '#6B4F2A'],
    ['minecraft:mycelium', '#8C7B8B'],
    ['minecraft:dirt', '#8B6A47'],
    ['minecraft:coarse_dirt', '#7A5C3E'],
    ['minecraft:rooted_dirt', '#9A7B57'],
    ['minecraft:farmland', '#5A4027'],
    ['minecraft:mud', '#3C3235'],
    ['minecraft:clay', '#A0A7B4'],
    ['minecraft:gravel', '#8E857C'],
    ['minecraft:sand', '#E0D9A0'],
    ['minecraft:red_sand', '#C1682F'],
    ['minecraft:sandstone', '#D9CE8F'],
    ['minecraft:red_sandstone', '#B45A28'],
    ['minecraft:stone', '#8A8A8A'],
    ['minecraft:cobblestone', '#7A7A7A'],
    ['minecraft:mossy_cobblestone', '#6F7F5F'],
    ['minecraft:smooth_stone', '#A0A0A0'],
    ['minecraft:stone_bricks', '#7E7E7E'],
    ['minecraft:mossy_stone_bricks', '#6E7E62'],
    ['minecraft:bricks', '#9A5A48'],
    ['minecraft:deepslate', '#4E4E52'],
    ['minecraft:tuff', '#6C6C64'],
    ['minecraft:calcite', '#DCDCD2'],
    ['minecraft:andesite', '#8A8A8A'],
    ['minecraft:diorite', '#C4C4C4'],
    ['minecraft:granite', '#A27664'],
    ['minecraft:basalt', '#4A4A52'],
    ['minecraft:blackstone', '#3A3238'],
    ['minecraft:netherrack', '#6B2626'],
    ['minecraft:soul_sand', '#5A4636'],
    ['minecraft:soul_soil', '#4B382C'],
    ['minecraft:end_stone', '#DDE3A4'],
    ['minecraft:bedrock', '#3A3A3A'],
    ['minecraft:snow', '#F2F7FA'],
    ['minecraft:snow_block', '#F2F7FA'],
    ['minecraft:powder_snow', '#F5FAFF'],
    ['minecraft:ice', '#A8C8E8'],
    ['minecraft:packed_ice', '#93B8E0'],
    ['minecraft:blue_ice', '#7AA6DC'],
    ['minecraft:water', '#3C6ECC'],
    ['minecraft:lava', '#D45A18'],
    ['minecraft:oak_log', '#6B5333'],
    ['minecraft:oak_planks', '#B08A4A'],
    ['minecraft:oak_leaves', '#4F8424'],
    ['minecraft:birch_log', '#D6D2C4'],
    ['minecraft:birch_planks', '#D7C68A'],
    ['minecraft:birch_leaves', '#6E9B3D'],
    ['minecraft:spruce_log', '#4A3826'],
    ['minecraft:spruce_planks', '#7A5B38'],
    ['minecraft:spruce_leaves', '#3D6B33'],
    ['minecraft:jungle_log', '#5C4A2A'],
    ['minecraft:jungle_planks', '#B0875A'],
    ['minecraft:jungle_leaves', '#3E8A2A'],
    ['minecraft:acacia_log', '#5C4A3A'],
    ['minecraft:acacia_planks', '#B0662E'],
    ['minecraft:acacia_leaves', '#5A8A3A'],
    ['minecraft:dark_oak_log', '#3E2C1A'],
    ['minecraft:dark_oak_planks', '#4E3820'],
    ['minecraft:dark_oak_leaves', '#2F6B2A'],
    ['minecraft:mangrove_log', '#6A4A3A'],
    ['minecraft:cherry_log', '#8A5A5A'],
    ['minecraft:cherry_leaves', '#F0A8C8'],
    ['minecraft:glass', '#C8E4F0'],
    ['minecraft:glowstone', '#D8B45A'],
    ['minecraft:sea_lantern', '#B8DCD0'],
    ['minecraft:white_terracotta', '#D8C8B4'],
    ['minecraft:terracotta', '#9A5A44'],
    ['minecraft:orange_terracotta', '#A05A2E'],
    ['minecraft:yellow_terracotta', '#A88C3A'],
    ['minecraft:white_concrete', '#D8DCE0'],
    ['minecraft:gray_concrete', '#5A5E62'],
    ['minecraft:black_concrete', '#20242A'],
    ['minecraft:white_wool', '#E8ECEF'],
    ['minecraft:gray_wool', '#5A5E62'],
    ['minecraft:hay_block', '#C8A03A'],
    ['minecraft:melon', '#6A9A3A'],
    ['minecraft:pumpkin', '#C07820'],
    ['minecraft:nether_bricks', '#3A1E22'],
    ['minecraft:quartz_block', '#E4E2DA'],
    ['minecraft:iron_block', '#C8C8C8'],
    ['minecraft:gold_block', '#E8C84A'],
    ['minecraft:diamond_block', '#6AD8D0'],
    ['minecraft:emerald_block', '#4AC85A'],
    ['minecraft:amethyst_block', '#8A62C8'],
    ['minecraft:copper_block', '#C07A50'],
    ['minecraft:cut_copper', '#C07A50'],
    ['minecraft:prismarine', '#6A9A8A'],
    ['minecraft:dark_prismarine', '#3A6A5A'],
    ['minecraft:sculk', '#1E2A32'],
    ['minecraft:moss_block', '#5A7A32'],
    ['minecraft:mangrove_roots', '#4A3A2A'],
    ['minecraft:magma_block', '#8A3A1A'],
    ['minecraft:crimson_nylium', '#7A1E2A'],
    ['minecraft:warped_nylium', '#2A6A5A'],
    ['minecraft:grass_path', '#9A8A5A'],
    ['minecraft:dirt_path', '#9A8A5A'],
    // 常见建筑轮廓（Overworld 首批对建筑可见很关键）
    ['minecraft:stone_slab', '#8A8A8A'],
    ['minecraft:smooth_quartz', '#E8E6DE'],
    ['minecraft:smooth_stone_slab', '#A0A0A0'],
    ['minecraft:dark_oak_planks', '#4E3820'],
    ['minecraft:spruce_planks', '#7A5B38'],
    ['minecraft:stripped_oak_log', '#C8A25A']
];

const WATER_BLOCKS = ['minecraft:water', 'minecraft:bubble_column', 'minecraft:kelp', 'minecraft:seagrass', 'minecraft:tall_seagrass', 'minecraft:ice'];

/** 材质兜底（未知 hash 或 fallback 高度配色时使用） */
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

/** 高度兜底色带（旧数据只有 heights 时使用）：从深到高 */
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
    ['minecraft:plains', 1, '#7CBD4C'],
    ['minecraft:sunflower_plains', 2, '#8CCB5C'],
    ['minecraft:snowy_plains', 3, '#E8F4F8'],
    ['minecraft:desert', 4, '#E0D9A0'],
    ['minecraft:swamp', 5, '#4A6B3A'],
    ['minecraft:forest', 6, '#4F8424'],
    ['minecraft:flower_forest', 7, '#5FA03A'],
    ['minecraft:birch_forest', 8, '#7FA85A'],
    ['minecraft:dark_forest', 9, '#2F6B2A'],
    ['minecraft:old_growth_birch_forest', 10, '#86AE60'],
    ['minecraft:taiga', 11, '#3D6B33'],
    ['minecraft:snowy_taiga', 12, '#CFE4EC'],
    ['minecraft:savanna', 13, '#B4A860'],
    ['minecraft:jungle', 14, '#3E8A2A'],
    ['minecraft:sparse_jungle', 15, '#5A9A3A'],
    ['minecraft:badlands', 16, '#C1682F'],
    ['minecraft:eroded_badlands', 17, '#B45A28'],
    ['minecraft:beach', 18, '#E8DFA8'],
    ['minecraft:snowy_beach', 19, '#EFF5F8'],
    ['minecraft:stony_shore', 20, '#8E857C'],
    ['minecraft:river', 21, '#3C6ECC'],
    ['minecraft:frozen_river', 22, '#A8C8E8'],
    ['minecraft:ocean', 23, '#2E5A7A'],
    ['minecraft:deep_ocean', 24, '#1B2A4A'],
    ['minecraft:warm_ocean', 25, '#2E6A9A'],
    ['minecraft:lukewarm_ocean', 26, '#2E5A8A'],
    ['minecraft:cold_ocean', 27, '#3A6A8A'],
    ['minecraft:frozen_ocean', 28, '#A8C8E8'],
    ['minecraft:mushroom_fields', 29, '#8C7B8B'],
    ['minecraft:meadow', 30, '#7CBD4C'],
    ['minecraft:grove', 31, '#CFE4EC'],
    ['minecraft:snowy_slopes', 32, '#E8F4F8'],
    ['minecraft:jagged_peaks', 33, '#C8C8C8'],
    ['minecraft:frozen_peaks', 34, '#F2F7FA'],
    ['minecraft:stony_peaks', 35, '#8A8A8A'],
    ['minecraft:cherry_grove', 36, '#F0A8C8'],
    ['minecraft:the_void', 37, '#20242A'],
    ['minecraft:nether_wastes', 38, '#6B2626'],
    ['minecraft:soul_sand_valley', 39, '#5A4636'],
    ['minecraft:crimson_forest', 40, '#7A1E2A'],
    ['minecraft:warped_forest', 41, '#2A6A5A'],
    ['minecraft:basalt_deltas', 42, '#4A4A52'],
    ['minecraft:the_end', 43, '#DDE3A4'],
    ['minecraft:end_highlands', 44, '#D8DFA0'],
    ['minecraft:end_midlands', 45, '#DDE3A4'],
    ['minecraft:small_end_islands', 46, '#E0E6B0'],
    ['minecraft:end_barrens', 47, '#D2D898']
];

/** 构建对外调色板对象（惰性缓存） */
let cachedPalette = null;
function getPalette() {
    if (cachedPalette) return cachedPalette;
    const blocks = {};
    const blockNames = {};
    for (const [name, color] of BLOCK_COLORS) {
        const h = hash16(name);
        blocks[h] = color;
        blockNames[h] = name;
    }
    const water = {};
    for (const name of WATER_BLOCKS) water[hash16(name)] = true;
    // 水面一定也在 blocks 里（材质兜底仍然可见）
    for (const name of WATER_BLOCKS) {
        const h = hash16(name);
        if (!blocks[h]) blocks[h] = MATERIALS.water;
        if (!blockNames[h]) blockNames[h] = name;
    }
    const biomes = {};
    for (const [name, id, color] of BIOME_COLORS) {
        biomes[String(id)] = color;
        biomes[String(hash16(name))] = color;
    }
    cachedPalette = {
        version: PALETTE_VERSION,
        blocks,
        water,
        materials: MATERIALS,
        heightShade: { minY: -64, maxY: 320, ramp: HEIGHT_RAMP },
        biomes,
        blockNames,
        note: 'hash = CRC32(minecraft 资源名) & 0xFFFF；客户端只消费颜色，不硬编码配色'
    };
    return cachedPalette;
}

module.exports = { PALETTE_VERSION, crc32, hash16, getPalette, BLOCK_COLORS, BIOME_COLORS, MATERIALS, HEIGHT_RAMP, WATER_BLOCKS };
