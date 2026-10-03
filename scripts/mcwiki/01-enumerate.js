/**
 * 阶段 1：枚举 zh.minecraft.wiki 的分类成员，产出候选页面清单
 *
 * 用法：node scripts/mcwiki/01-enumerate.js
 * 产物：data/mcwiki/catalog.json  （按分类分组的成员，含 ns 与子分类）
 *
 * 只读：不写数据库、不调用我们自己的 API。
 * 授权提醒：来源站内容为 CC BY-NC-SA 3.0，本流程只把它当**参考**，
 * 最终入库正文由改写阶段重写，并强制带来源与许可标注。
 */
const fs = require('fs');
const path = require('path');

const API = 'https://zh.minecraft.wiki/api.php';
const UA = 'xuanjian-wiki-importer/0.1 (+https://xuanjian.top; admin@xuanjian.top)';
const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'mcwiki');

const CATS = [
  'Category:红石',
  'Category:红石机制',
  'Category:红石电路',
  'Category:机制',
  'Category:教程',
  'Category:生物',
  'Category:敌对生物',
  'Category:亡灵生物',
  'Category:友好生物',
  'Category:村民职业',
  'Category:游戏内容',
  'Category:生成结构',
  'Category:维度',
  'Category:方块',
  'Category:物品'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params, tries = 4) {
  const url = API + '?' + new URLSearchParams({ format: 'json', ...params }).toString();
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error(`${params.list || params.action} 失败：${lastErr && lastErr.message}`);
}

/** 取一个分类的全部成员（自动翻页），同时分开 page / subcat */
async function categoryMembers(cat) {
  const pages = [];
  const subcats = [];
  let cont = {};
  for (let guard = 0; guard < 20; guard++) {
    const data = await api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: '500', ...cont });
    for (const m of data.query?.categorymembers || []) {
      if (m.ns === 14) subcats.push(m.title);
      else pages.push({ title: m.title, ns: m.ns });
    }
    if (!data.continue) break;
    cont = data.continue;
    await sleep(200);
  }
  return { pages, subcats };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const catalog = { fetchedAt: new Date().toISOString(), source: 'https://zh.minecraft.wiki/', license: 'CC BY-NC-SA 3.0', cats: {} };
  for (const cat of CATS) {
    try {
      const { pages, subcats } = await categoryMembers(cat);
      catalog.cats[cat] = { pages, subcats };
      console.log(`${cat.padEnd(18)} 主空间/其他 ${String(pages.length).padStart(4)} 条   子分类 ${subcats.length}`);
    } catch (e) {
      catalog.cats[cat] = { error: String(e.message) };
      console.log(`${cat.padEnd(18)} 失败：${e.message}`);
    }
    await sleep(250);
  }
  const file = path.join(OUT_DIR, 'catalog.json');
  fs.writeFileSync(file, JSON.stringify(catalog, null, 1), 'utf8');
  const all = new Set();
  for (const c of Object.values(catalog.cats)) for (const p of c.pages || []) all.add(p.title);
  console.log(`\n去重后候选标题 ${all.size} 个 → ${file}`);
}

main().catch((e) => {
  console.error('枚举失败：', e.message);
  process.exit(1);
});
