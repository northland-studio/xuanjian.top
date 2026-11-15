/**
 * 生成 `lib/gis/block-colors.json`：vanilla 方块 → 近似主色（供 /api/gis/map/palette 使用）。
 *
 * 用法：node scripts/gis-gen-block-colors.js
 * 输入：scripts/tests/fixtures/vanilla-blocks.json（vanilla 方块资源名 path 列表，随仓库维护）
 * 输出：lib/gis/block-colors.json（{ "grass_block": "#7CBD4C", ... }）
 *
 * 原则：
 *  - 常用地表/建材/水/植被方块给**接近材质主色**，保证方块彩色地图可辨识；
 *  - 阶梯/台阶/墙/门/栅栏等功能方块继承其基础材质色；
 *  - 认不出的方块落到材质灰（#7A7A7A，非黑色）；后续可手工覆盖。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'scripts/tests/fixtures/vanilla-blocks.json');
const OUT = path.join(ROOT, 'lib/gis/block-colors.json');

const NAMES = JSON.parse(fs.readFileSync(IN, 'utf8'));
const UNKNOWN = '#7A7A7A';

/* ---------------- 基础色表 ---------------- */

const CURATED = {
    grass_block: '#7CBD4C', grass_block_snow: '#E8F4F8', podzol: '#6B4F2A', mycelium: '#8C7B8B',
    dirt: '#8B6A47', coarse_dirt: '#7A5C3E', rooted_dirt: '#9A7B57', farmland: '#5A4027',
    mud: '#3C3235', muddy_mangrove_roots: '#3C4A32', clay: '#A0A7B4', gravel: '#8E857C',
    sand: '#E0D9A0', red_sand: '#C1682F', sandstone: '#D9CE8F', red_sandstone: '#B45A28',
    stone: '#8A8A8A', cobblestone: '#6E6E6E', mossy_cobblestone: '#6F7F5F', smooth_stone: '#A0A0A0',
    stone_bricks: '#7E7E7E', mossy_stone_bricks: '#6E7E62', cracked_stone_bricks: '#74746E',
    chiseled_stone_bricks: '#787872', bricks: '#9A5A48', deepslate: '#4E4E52',
    cobbled_deepslate: '#5A5A5E', polished_deepslate: '#56565A', deepslate_bricks: '#4A4A4E',
    deepslate_tiles: '#46464A', tuff: '#6C6C64', polished_tuff: '#767670', calcite: '#DCDCD2',
    andesite: '#8A8A8A', polished_andesite: '#949494', diorite: '#C4C4C4', polished_diorite: '#CCCCCC',
    granite: '#A27664', polished_granite: '#AA806E', basalt: '#4A4A52', smooth_basalt: '#52525A',
    blackstone: '#3A3238', polished_blackstone: '#423A40', netherrack: '#6B2626',
    soul_sand: '#5A4636', soul_soil: '#4B382C', end_stone: '#DDE3A4', end_stone_bricks: '#D2DA96',
    bedrock: '#3A3A3A', obsidian: '#2A1E3A', crying_obsidian: '#3A2A6A',
    snow: '#F2F7FA', snow_block: '#F2F7FA', powder_snow: '#F5FAFF', ice: '#A8C8E8',
    packed_ice: '#93B8E0', blue_ice: '#7AA6DC', frosted_ice: '#C8E0F0',
    water: '#3C6ECC', lava: '#D45A18', fire: '#E8A030', soul_fire: '#4AC8E0',
    magma_block: '#8A3A1A', glowstone: '#D8B45A', sea_lantern: '#B8DCD0', shroomlight: '#E8A050',
    glass: '#C8E4F0', tinted_glass: '#3A3A3A',
    terracotta: '#9A5A44', white_terracotta: '#D8C8B4', hay_block: '#C8A03A',
    melon: '#6A9A3A', pumpkin: '#C07820', carved_pumpkin: '#C07820', jack_o_lantern: '#E0A030',
    nether_bricks: '#3A1E22', red_nether_bricks: '#5A1E22', quartz_block: '#E4E2DA',
    smooth_quartz: '#E8E6DE', iron_block: '#C8C8C8', gold_block: '#E8C84A',
    diamond_block: '#6AD8D0', emerald_block: '#4AC85A', amethyst_block: '#8A62C8',
    lapis_block: '#2A5AA8', redstone_block: '#A82820', coal_block: '#242424',
    copper_block: '#C07A50', cut_copper: '#C07A50', exposed_copper: '#A88A6A',
    weathered_copper: '#7FA88A', oxidized_copper: '#5FA88A',
    raw_iron_block: '#B08A6A', raw_copper_block: '#A87A5A', raw_gold_block: '#D8B84A',
    netherite_block: '#4A4048', ancient_debris: '#5A4038', nether_gold_ore: '#8A5A3A',
    nether_quartz_ore: '#B08A7A', glow_lichen: '#7A9A8A', sculk: '#1E2A32', sculk_catalyst: '#243A44',
    moss_block: '#5A7A32', moss_carpet: '#5A7A32', grass_path: '#9A8A5A', dirt_path: '#9A8A5A',
    prismarine: '#6A9A8A', prismarine_bricks: '#5A8A7A', dark_prismarine: '#3A6A5A',
    purpur_block: '#A87AA8', purpur_pillar: '#B084B0',
    oak_planks: '#B08A4A', birch_planks: '#D7C68A', spruce_planks: '#7A5B38', jungle_planks: '#B0875A',
    acacia_planks: '#B0662E', dark_oak_planks: '#4E3820', mangrove_planks: '#7A5A3A',
    cherry_planks: '#E0A8A8', bamboo_planks: '#C8B458', crimson_planks: '#7A3A4A',
    warped_planks: '#3A7A6A', pale_oak_planks: '#D8C8A8',
    oak_log: '#6B5333', birch_log: '#D6D2C4', spruce_log: '#4A3826', jungle_log: '#5C4A2A',
    acacia_log: '#5C4A3A', dark_oak_log: '#3E2C1A', mangrove_log: '#6A4A3A', cherry_log: '#8A5A5A',
    bamboo_block: '#8AA84A', crimson_stem: '#6A2A3A', warped_stem: '#2A5A4A', pale_oak_log: '#C8B898',
    stripped_oak_log: '#C8A25A', oak_wood: '#6B5333', birch_wood: '#D6D2C4', spruce_wood: '#4A3826',
    oak_leaves: '#4F8424', birch_leaves: '#6E9B3D', spruce_leaves: '#3D6B33', jungle_leaves: '#3E8A2A',
    acacia_leaves: '#5A8A3A', dark_oak_leaves: '#2F6B2A', mangrove_leaves: '#4A7A3A',
    cherry_leaves: '#F0A8C8', azalea_leaves: '#5E7A3A', flowering_azalea_leaves: '#6E9A4A',
    pale_oak_leaves: '#6E9B4D',
    oak_sapling: '#4F8424', short_grass: '#7CBD4C', tall_grass: '#7CBD4C',
    fern: '#5A9A3A', large_fern: '#5A9A3A', dead_bush: '#8A6A3A', sugar_cane: '#8AC860',
    cactus: '#4A7A2A', bamboo: '#8AA84A', vine: '#4F8424', lily_pad: '#4A8A3A',
    dandelion: '#E8D040', poppy: '#C83830', blue_orchid: '#38A8E0', allium: '#B08AD0',
    azure_bluet: '#E8E8F0', red_tulip: '#C83830', orange_tulip: '#E88A2A', white_tulip: '#E8E8F0',
    pink_tulip: '#E89AB0', oxeye_daisy: '#E8E8E8', cornflower: '#4A6AE0', lily_of_the_valley: '#E8F0E8',
    wither_rose: '#403030', torchflower: '#E8A030', sunflower: '#E8C840', lilac: '#C89AD0', rose_bush: '#B83A3A', peony: '#E8A8C0',
    brown_mushroom: '#8A6A4A', red_mushroom: '#C83A32', crimson_fungus: '#8A3A4A', warped_fungus: '#3A7A6A',
    nether_wart_block: '#7A1E22', warped_wart_block: '#2A6A5A', azalea: '#5E7A3A', flowering_azalea: '#6E9A4A',
    big_dripleaf: '#4A8A3A', small_dripleaf: '#5A9A4A', spore_blossom: '#E89AC8', moss_carpet2: '#5A7A32',
    pumpkin_stem: '#8A9A4A', melon_stem: '#8A9A4A', cocoa: '#8A5A2A', sweet_berry_bush: '#6A8A3A',
    cave_vines: '#5A8A3A', glow_berries: '#E8A050', hanging_roots: '#6A4A2A',
    mushroom_stem: '#C8B8A0', mushroom_block: '#A88A6A',
    // 功能/建筑（直接给主色）
    iron_bars: '#8A8A8A', chain: '#7A7A7A', ladder: '#8A6A3A', scaffolding: '#C8B458',
    lantern: '#C8A85A', soul_lantern: '#4AC8E0', campfire: '#8A5A2A', soul_campfire: '#3A8A9A',
    torch: '#E8C060', soul_torch: '#4AC8E0', end_rod: '#E8E0C8', candle: '#E8E0C8',
    beacon: '#5FD8E8', conduit: '#8AA8C8', anvil: '#4A4A4A', cauldron: '#4A4A4A',
    hopper: '#5A5A5A', composter: '#8A6A3A', barrel: '#8A6A3A', chest: '#B08A4A',
    bookshelf: '#B08A4A', lectern: '#B08A4A', crafting_table: '#B08A4A', furnace: '#7A7A7A',
    smoker: '#6A6A6A', blast_furnace: '#5A5A5A', cartography_table: '#8A6A4A',
    fletching_table: '#C8B458', smithing_table: '#4A4A52', loom: '#B08A4A', stonecutter: '#8A8A8A',
    grindstone: '#7A7A7A', bell: '#E8C84A', note_block: '#7A5A3A', jukebox: '#6A4A2A',
    sponge: '#C8C85A', wet_sponge: '#A8A84A', slime_block: '#7AC85A', honey_block: '#E8B04A',
    target: '#E8E0C8', tnt: '#C83A32', respawn_anchor: '#4A2A6A', lodestone: '#A8A8A8',
    amethyst_cluster: '#B08AE0', budding_amethyst: '#9A7AD0',
    // 金属/矿石（原矿）
    coal_ore: '#5A5A5A', iron_ore: '#8A7060', copper_ore: '#8A7A66', gold_ore: '#A89050',
    redstone_ore: '#7A3A32', lapis_ore: '#4A5A7A', diamond_ore: '#6A9A9A', emerald_ore: '#4A8A5A',
    deepslate_coal_ore: '#4A4A4E', deepslate_iron_ore: '#5A4A44', deepslate_copper_ore: '#5A5248',
    deepslate_gold_ore: '#6A5A3A', deepslate_redstone_ore: '#4A2E2A', deepslate_lapis_ore: '#3A4458',
    deepslate_diamond_ore: '#466A6A', deepslate_emerald_ore: '#3A6650',
    // 下界/末地
    nether_wart: '#6A2A2A', warped_roots: '#3A7A6A', crimson_roots: '#8A3A4A',
    nether_sprouts: '#3A8A7A', nylium_crimson: '#7A1E2A', nylium_warped: '#2A6A5A',
    shroomlight2: '#E8A050', twisting_vines: '#3A8A6A', weeping_vines: '#7A3A4A'
};

const COLOR16 = {
    white: '#E8ECEF', orange: '#E08A2A', magenta: '#C85AC8', light_blue: '#6AB0E0',
    yellow: '#E8D04A', lime: '#8AD04A', pink: '#E8A0B8', gray: '#5A5E62',
    light_gray: '#A8A8A8', cyan: '#3A8A9A', purple: '#7A3A9A', blue: '#3A4AB0',
    brown: '#7A5A3A', green: '#4A6A2A', red: '#A82A2A', black: '#242424'
};

const WOOD = {
    oak: '#B08A4A', spruce: '#7A5B38', birch: '#D7C68A', jungle: '#B0875A', acacia: '#B0662E',
    dark_oak: '#4E3820', mangrove: '#7A5A3A', cherry: '#E0A8A8', bamboo: '#C8B458',
    crimson: '#7A3A4A', warped: '#3A7A6A', pale_oak: '#D8C8A8'
};

const STRUCT_SUFFIX = [
    '_stairs', '_slab', '_wall', '_fence_gate', '_fence', '_door', '_trapdoor', '_button',
    '_pressure_plate', '_wall_sign', '_wall_hanging_sign', '_hanging_sign', '_sign',
    '_carpet', '_pane', '_bed', '_banner', '_candle_cake', '_candle'
];

function stripSuffix(name) {
    for (const s of STRUCT_SUFFIX) if (name.endsWith(s)) return name.slice(0, -s.length);
    return null;
}

function resolveWood(name) {
    const m = name.match(/^([a-z_]+)_(planks|log|wood|leaves|sapling|stairs|slab|fence|fence_gate|door|trapdoor|sign|wall_sign|button|pressure_plate|hanging_sign|wall_hanging_sign|wall|boat|chest|mosaic|shelf|stairs)$/);
    if (m && WOOD[m[1]]) return WOOD[m[1]];
    return null;
}

function colorOf(name) {
    if (CURATED[name]) return CURATED[name];
    // 结构方块继承基础材质
    const base = stripSuffix(name);
    if (base) {
        if (CURATED[base]) return CURATED[base];
        const w = resolveWood(base);
        if (w) return w;
        if (/(concrete|wool|terracotta|glass|_block)/.test(base)) {
            const c = colorOf(base);
            if (c && c !== UNKNOWN) return c;
        }
        const c2 = colorOf(base);
        if (c2 && c2 !== UNKNOWN) return c2;
    }
    // 16 色系
    let m = name.match(/^([a-z_]+?)_?(wool|concrete_powder|concrete|terracotta|stained_glass_pane|stained_glass|glazed_terracotta|carpet|bed|banner|shulker_box|candle)$/);
    if (m) {
        const colorKey = name.replace(/_(wool|concrete_powder|concrete|terracotta|stained_glass_pane|stained_glass|glazed_terracotta|carpet|bed|banner|shulker_box|candle)$/, '');
        if (COLOR16[colorKey]) return COLOR16[colorKey];
    }
    if (/^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_/.test(name)) {
        const colorKey = name.split('_').slice(0, name.startsWith('light_') ? 2 : 1).join('_');
        if (COLOR16[colorKey]) {
            // 混凝土/羊毛更亮，陶瓦更暗
            if (/terracotta|glazed/.test(name)) return shade(COLOR16[colorKey], 0.85);
            if (/wool|carpet|bed|banner/.test(name)) return shade(COLOR16[colorKey], 1.05);
            return COLOR16[colorKey];
        }
    }
    // 木头/树叶系列
    const w = resolveWood(name);
    if (w) return w;
    if (/_leaves$|_sapling$/.test(name)) {
        const t = name.replace(/_(leaves|sapling)$/, '');
        if (WOOD[t]) return shade(WOOD[t], 0.8);
    }
    // 氧化物铜
    if (/copper/.test(name)) {
        if (/oxidized/.test(name)) return '#5FA88A';
        if (/weathered/.test(name)) return '#7FA88A';
        if (/exposed/.test(name)) return '#A88A6A';
        return '#C07A50';
    }
    // 常用关键字
    const RULES = [
        [/water|bubble|kelp|seagrass/, '#3C6ECC'],
        [/^lava$|magma/, '#D45A18'],
        [/snow|powder_snow/, '#F2F7FA'],
        [/^ice$|frosted_ice|packed_ice|blue_ice/, '#A8C8E8'],
        [/sand$|_sand$/, '#E0D9A0'],
        [/gravel/, '#8E857C'],
        [/dirt|podzol|mud|farmland|rooted/, '#8B6A47'],
        [/grass|fern|azalea|moss|vine|leaf|leaves|bamboo|cactus|melon|pumpkin|hay|wheat|crop|carrot|potato|beetroot|berry/, '#5A8A32'],
        [/deepslate/, '#4E4E52'],
        [/blackstone|basalt/, '#3A3238'],
        [/netherrack|nether_wart/, '#6B2626'],
        [/soul_/, '#4B382C'],
        [/end_stone|purpur/, '#D9DE9E'],
        [/quartz|calcite|diorite|white_/, '#E0DED6'],
        [/stone|cobble|andesite|tuff|brick|slate|granite|deepslate|sandstone/, '#8A8A8A'],
        [/glass/, '#C8E4F0'],
        [/iron|anvil|chain|hopper|cauldron/, '#8A8A8A'],
        [/gold|bell/, '#E8C84A'],
        [/diamond|emerald|amethyst|prismarine|sea_lantern|conduit/, '#6AC8C0'],
        [/copper/, '#C07A50'],
        [/coal/, '#2A2A2A'],
        [/redstone/, '#A82820'],
        [/lapis/, '#2A5AA8'],
        [/obsidian|sculk/, '#2A2438'],
        [/crafting|barrel|chest|bookshelf|lectern|loom|table|wood|log|planks|fence|door|sign/, '#B08A4A'],
        [/rail|minecart/, '#8A8A8A'],
        [/torch|lantern|glowstone|light|fire|campfire|candle/, '#E8C060'],
        [/flower|tulip|rose|daisy|orchid|bluet|allium|lilac|peony|sunflower|dandelion|poppy/, '#E8C040'],
        [/mushroom|fungus/, '#8A6A4A'],
        [/wool|carpet/, '#D8DCE0'],
        [/concrete/, '#8A8A8A'],
        [/terracotta/, '#9A5A44'],
        [/copper_grate|chiseled/, '#9A7A5A'],
        [/amethyst/, '#9A7AD0'],
        [/coral_block$|coral$|coral_fan$/, '#D85A8A'],
        [/dead_.*coral/, '#8A7A6A'],
        [/hyphae|stem$/, '#6A3A4A'],
        [/chorus/, '#A87AA8'],
        [/head$|skull$/, '#C8B8A0'],
        [/command_block|structure_block|jigsaw|barrier|light$|structure_void|debug/, '#8A5A9A'],
        [/comparator|repeater|observer|piston|dispenser|dropper|piston_head/, '#8A8A8A'],
        [/bee_nest|beehive/, '#C8A040'],
        [/cake|cookie|pie|bread|egg$/, '#D8B080'],
        [/cobweb|web/, '#D8DCE0'],
        [/resin|creaking|pale_/, '#C8B8A8'],
        [/bush|firefly|leaf_litter|wildflowers|eyeblossom/, '#6E9B4D'],
        [/cinnabar/, '#B03A2E'],
        [/copper_grate|chiseled/, '#9A7A5A']
    ];
    for (const [re, color] of RULES) if (re.test(name)) return color;
    return UNKNOWN;
}

function shade(hex, f) {
    const h = hex.replace('#', '');
    const r = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(0, 2), 16) * f)));
    const g = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(2, 4), 16) * f)));
    const b = Math.max(0, Math.min(255, Math.round(parseInt(h.slice(4, 6), 16) * f)));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

const out = {};
const unknownNames = [];
for (const name of NAMES) {
    const color = colorOf(name);
    out[name] = color;
    if (color === UNKNOWN) unknownNames.push(name);
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('generated:', OUT);
console.log('blocks:', NAMES.length, 'colored:', NAMES.length - unknownNames.length,
    'unknown:', unknownNames.length, 'size:', (fs.statSync(OUT).size / 1024).toFixed(1) + 'KB');
if (unknownNames.length) console.log('unknown sample:', unknownNames.slice(0, 40).join(', '));
