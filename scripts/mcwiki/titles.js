/**
 * 生电（红石 / 技术性生存）常用页面选题清单
 *
 * 全部标题都来自 zh.minecraft.wiki 的真实分类成员（见 data/mcwiki/catalog.json），
 * 由 scripts/mcwiki/01-enumerate.js 枚举得到。抓取脚本会报告不存在的标题。
 *
 * 用法：require('./titles') → { groups, list() }
 */
const groups = {
  // 红石基础与元件：查手册时最常翻的条目
  '红石基础与元件': [
    '红石电路', '红石粉', '红石火把', '红石中继器', '红石比较器', '红石块', '红石灯',
    '红石元件列表', '活塞', '侦测器', '发射器', '投掷器', '漏斗', '动力铁轨', '探测铁轨',
    '激活铁轨', '铁轨', '矿车', '拉杆', '按钮', '木按钮', '石头按钮', '压力板',
    '轻质测重压力板', '重质测重压力板', '木压力板', '石头压力板', '标靶', '音符盒',
    '阳光探测器', '绊线钩', '线', '陷阱箱', 'TNT', '幽匿感测体', '校频幽匿感测体',
    '合成器', '活板门', '木活板门', '铁活板门', '栅栏门', '黏液块', '蜂蜜块', '含水'
  ],

  // 红石电路与理论：生电的核心方法论
  '红石电路与理论': [
    '逻辑电路', '传输电路', '脉冲电路', '时钟电路',
    'Tutorial:基本逻辑门', 'Tutorial:算术逻辑', 'Tutorial:高频电路', 'Tutorial:时钟',
    'Tutorial:计时器', 'Tutorial:随机发生器', 'Tutorial:红石技巧', 'Tutorial:红石术语表',
    'Tutorial:高级红石电路', 'Tutorial:活塞使用', 'Tutorial:活塞电路', 'Tutorial:零刻活塞',
    'Tutorial:无头活塞', 'Tutorial:方块更新感应器', 'Tutorial:比较器更新感应器',
    'Tutorial:更新抑制', 'Tutorial:更新跳略', 'Tutorial:半连接性', 'Tutorial:侦测器稳定器',
    'Tutorial:零刻作物催熟技术', 'Tutorial:无延迟科技', 'Tutorial:红石计算机',
    'Tutorial:红石计算器', 'Tutorial:BUD链'
  ],

  // 机制与理论：不搞懂这些，农场设计只能是抄
  '机制与技术理论': [
    '生物生成', '亮度', '爆炸', '刻', '区块', '方块更新', '判定箱', '寻路', '属性',
    '伤害', '作物机制', '可再生资源', '生成结构', '维度',
    'Tutorial:空置域', 'Tutorial:光照抑制', 'Tutorial:光照抑制刷怪塔', 'Tutorial:光照操纵',
    'Tutorial:村庄机制', 'Tutorial:伪和平', 'Tutorial:计量单位', 'Tutorial:游戏术语',
    'Tutorial:机械', 'Tutorial:红石机械', 'Tutorial:方块和物品复制', 'Tutorial:爆炸控制',
    'Tutorial:结构方块', 'Tutorial:命令方块', 'Tutorial:目标选择器'
  ],

  // 农场与陷阱：生电的产出部分
  '农场与陷阱': [
    'Tutorial:刷怪塔', 'Tutorial:刷石机', 'Tutorial:刷冰', 'Tutorial:刷雪机', 'Tutorial:刷蛋',
    'Tutorial:刷鱼', 'Tutorial:刷怪笼陷阱', 'Tutorial:铁傀儡陷阱', 'Tutorial:史莱姆陷阱',
    'Tutorial:女巫陷阱', 'Tutorial:守卫者陷阱', 'Tutorial:凋灵骷髅陷阱', 'Tutorial:烈焰人陷阱',
    'Tutorial:溺尸陷阱', 'Tutorial:末影人陷阱', 'Tutorial:僵尸猪灵陷阱', 'Tutorial:岩浆怪陷阱',
    'Tutorial:洞穴蜘蛛陷阱', 'Tutorial:蠹虫陷阱', 'Tutorial:疣猪兽陷阱', 'Tutorial:袭击农场',
    'Tutorial:潜影贝农场', 'Tutorial:悦灵农场', 'Tutorial:羊毛农场', 'Tutorial:苦力怕农场',
    'Tutorial:甘蔗种植', 'Tutorial:仙人掌种植', 'Tutorial:海带种植', 'Tutorial:蘑菇种植',
    'Tutorial:树木种植', 'Tutorial:紫水晶农场', 'Tutorial:骨粉机', 'Tutorial:黑曜石农场',
    'Tutorial:基岩农场', 'Tutorial:熔岩农场', 'Tutorial:蛙明灯农场', 'Tutorial:唱片农场',
    'Tutorial:垂根农场', 'Tutorial:滴水石锥农场', 'Tutorial:泥土农场',
    'Tutorial:通用物品分类器', 'Tutorial:物品运输', 'Tutorial:水道', 'Tutorial:电梯',
    'Tutorial:飞行器', 'Tutorial:挂机池', 'Tutorial:获得经验', 'Tutorial:自动化烧炼',
    'Tutorial:处死装置', 'Tutorial:村民交易所', 'Tutorial:治愈僵尸村民', 'Tutorial:村民养殖',
    'Tutorial:生物运输', 'Tutorial:数字化矿车存储系统', 'Tutorial:潜影盒储存',
    'Tutorial:整理物品', 'Tutorial:漏斗', 'Tutorial:打包机', 'Tutorial:拆包机',
    'Tutorial:矿车储存'
  ],

  // 生物与结构：判断农场可行性的基础资料
  '生物与结构': [
    '村民', '村民职业', '铁傀儡', '刷怪笼', '生物', '敌对生物', '亡灵生物', '以物易物',
    '交易', '村庄', '下界要塞', '堡垒遗迹', '末地城', '远古城市', '试炼密室',
    '掠夺者前哨站', '下界', '末地', '药水酿造', '魔咒'
  ]
};

/** 扁平化清单：[{ title, group }] */
function list() {
  const out = [];
  for (const [group, titles] of Object.entries(groups)) {
    for (const title of titles) out.push({ title, group });
  }
  return out;
}

/** 安全文件名（保留中文，替换路径分隔符） */
function keyOf(title) {
  return title.replace(/[:/\\?*"<>|]/g, '_').replace(/\s+/g, '_');
}

/**
 * 最终入库标题：去掉 Minecraft Wiki 的 Tutorial: 命名空间前缀。
 * 撞名时的例外（源标题 → 我们的标题）：
 *   Tutorial:漏斗 与核心页「漏斗」同为「漏斗」，会把后者顶掉，故改为「漏斗运输」。
 */
const TITLE_OVERRIDES = {
  'Tutorial:漏斗': '漏斗运输'
};

function finalTitle(sourceTitle) {
  const src = String(sourceTitle || '').trim();
  if (TITLE_OVERRIDES[src]) return TITLE_OVERRIDES[src];
  return src.replace(/^Tutorial:\s*/, '').trim();
}

module.exports = { groups, list, keyOf, finalTitle, TITLE_OVERRIDES };
