# 渲染架构（SSG / SSR / SPA）

xuanjian.top 是 Express 4 + React 19 + Vite 的 SPA，首屏 SEO 与加载速度由 **三层渲染** 补齐：
能预渲染的页面在发布时生成静态 HTML（SSG），依赖实时数据的页面按请求服务端渲染（SSR），
其余（登录态、后台、编辑器、支付、聊天等）保持原来的纯客户端渲染（SPA）。

三层对同一份预取数据做「服务端渲染 + 客户端 hydrate」，因此 `frontend/src/entry-server.jsx`
与客户端入口共用同一套组件树，注入的 `window.__SSR_DATA__` 保证 hydrate 前后首屏完全一致。

---

## 1. 三层划分

| 层 | 生成时机 | 覆盖路由 | Provider | head |
|:---|:---|:---|:---|:---|
| **SSG** | 构建/发布时预渲染成静态 HTML，请求直接发文件；文件缺失时现场渲染并落盘（自愈） | `/wiki`、`/wiki/category/:slug`、`/wiki/:slug` | `lib/prefetch/wiki.js` | 每篇文章标题/摘要/封面 |
| **SSG** | 同上 | `/daily`、`/decision`、`/mods`、`/projections` | `lib/prefetch/content-list.js` | 每页专属 title/description |
| **SSR** | 按请求服务端渲染，进程内缓存 60 秒 | `/`、`/post/:id`、`/posts/:id`、`/profile/:username` | `lib/prefetch/content.js` | 帖子标题/摘要/首图、成员主页 |
| **SSR** | 同上 | `/gmirs`、`/gdars`、`/rankings`、`/donation` | `lib/prefetch/members.js` | 四页专属 title/description |
| **SPA** | 纯客户端渲染（改造前行为，不变） | 其余全部路由 | 无 | 站点默认（客户端 `setPageSeo` 接管） |

**保持 SPA 的路由**（`frontend/src/App.jsx` 里除上表之外的全部）：

- 登录态/个人操作：`/login`、`/register`、`/settings`、`/profile`（自己的主页）、`/notifications`、
  `/checkin`、`/claims`、`/inventory`、`/tasks`、`/following`、`/chat/:userId`
- 后台与编辑：`/admin`、`/editor/:id`、`/wiki/editor`、`/wiki/editor/:id`、`/wiki/:slug/history`
- 交易/支付：`/shop`、`/trade`、`/economics`、`/pay`、`/pay/:token`、`/pay/charge/:token`、
  `/pay/charge-new`、`/pay/records`、`/pay/admin`、`/pay/confirm/:token`
- 其它：`/forum`、`/team`、`/social`、`/freeze`、`/wiki/search`、`*`（404 回首页）
- **带查询参数的形态**：`/daily?page=2`、`/decision?search=x`、`/rankings?type=contribution`、
  `/gmirs?keyword=x` …（是否预取由各 Provider 决定，见 §5 第 6 条）

**资源不存在也回退 SPA**：Provider 的 `load()` 返回 `null` 表示「这个 URL 服务端不渲染」——
帖子不存在/已删除（`status != active`）、被冻结成员（`users.is_frozen = 1`）、Wiki 草稿/未发布页面、
不存在的 username/slug 等，都交回 SPA 显示「不存在」。**不会**把 404 变成 200。

---

## 2. 目录与产物

| 路径 | 内容 | 生成方式 |
|:---|:---|:---|
| `frontend/dist/` | 客户端 SPA 产物（`index.html` + `assets/`），入口已注入 Rocket Loader 免疫自举脚本 | `cd frontend && npm run build` → `node scripts/patch-index-bootstrap.js frontend/dist` |
| `frontend/dist-ssr/` | 服务端渲染产物 `entry-server.js`（依赖已内联成单文件，服务器不需要前端 `node_modules`） | `cd frontend && npx vite build --ssr src/entry-server.jsx --outDir dist-ssr`（= `npm run build:ssr`） |
| `frontend/prerender/` | SSG 静态 HTML，文件名 = 路径（`/` → `index.html`，`/wiki/a` → `wiki__a.html`） | `node scripts/prerender.js [--clean]` |

代码位置：

| 文件 | 职责 |
|:---|:---|
| `lib/ssr.js` | 渲染中间件 + `renderUrl(url, ctx)`、head 组装、模板注入、SSG 文件读写与失效 |
| `lib/prefetch/index.js` | Provider 注册表（自动扫描 `lib/prefetch/*.js`）：`classify()`、`loadData()`、`listSsgRoutes()`、`describe()` |
| `lib/prefetch/<name>.js` | 每个页面的预取数据（`ssg` / `ssr` / `load` / `head` / `enumerate`） |
| `frontend/src/entry-server.jsx` | 服务端入口：`render(url, serverData)` → `renderToString(MemoryRouter + App)` |
| `frontend/src/context/ServerDataContext.jsx` | `useServerData(key)` —— 页面读预取数据 |
| `scripts/prerender.js` | 批量生成 `frontend/prerender/*.html` |
| `scripts/test-ssr.js` | 三层渲染端到端自检（只读副本 + 真实渲染） |

`server.js` 里的挂载顺序（**顺序不能改**）：

```
静态资源 → /api 路由 → ssr.middleware() → SPA 回退（frontend/dist/index.html）
```

`lib/ssr.js` 的请求处理：

1. `SPA_ONLY=1`（或 `SSR_ENABLED=0`）→ 直接 `next()`，全站纯 SPA；
2. 命中 SSG 路由 → 有 `frontend/prerender/<路径>.html` 就发文件，没有就现场渲染并落盘，`X-Render-Mode: ssg`；
3. 命中 SSR 路由 → 现场渲染 + 进程内缓存，`X-Render-Mode: ssr` / `ssr-cache`；
4. 其余 → `next()`，走 SPA 回退（`X-Render-Mode` 为空）。

响应头 `X-Render-Mode` 可以直接看出某个 URL 当前是 `ssg` / `ssr` / `ssr-cache` / 空（SPA）：

```bash
curl -s -D - -o /dev/null http://localhost:3000/wiki | grep -i x-render-mode
```

---

## 3. 缓存策略

| 层 | 有效期 | 实现 | 内容更新后 |
|:---|:---|:---|:---|
| SSG | **10 分钟** | `Cache-Control: public, max-age=600, stale-while-revalidate=60`（`SSG_TTL_MS`） | 业务代码调用 `lib/ssr.js` 的 `invalidate(url)`（单页）或 `invalidatePrefix(prefix)`（整棵分类树）删除产物，下次请求自动重建；再配合 CDN 清理 |
| SSG（CDN） | 10 分钟 | Cloudflare 边缘 | `bash scripts/purge-cache.sh`（整站）或 `bash scripts/purge-cache.sh "https://xuanjian.top/wiki/a,https://xuanjian.top/daily"`（指定 URL）。需要 `CF_ZONE_ID` / `CF_API_TOKEN`；缺凭据只提示不报错 |
| SSR | **60 秒** | 进程内 `Map<url, {html, at}>`（`SSR_TTL_MS`），超过 300 条会清掉过期项 | 等 60 秒自然过期，或 `pm2 restart` 重启进程 |
| 模板 | 进程生命周期 | `getTemplate()` 缓存 `frontend/dist/index.html` | 重新部署前端产物后调用 `resetTemplate()`（会同时清空 SSR 缓存） |

SSR 缓存按「完整 URL（含 query）」区分；SSG 产物按 pathname 命名，因此 `/daily?page=2` 命中的是
`/daily` 的静态产物（翻页/搜索由客户端接管，见 §5 第 6 条）。

---

## 4. 一键回退（SPA_ONLY）

出问题时不需要回滚代码或删产物：

```bash
# 生产（PM2）：全站立刻回退纯 SPA
SPA_ONLY=1 pm2 restart xuanjian-guild --update-env
pm2 list | grep xuanjian-guild
```

- `SPA_ONLY=1`：中间件直接 `next()`，所有 URL 走原来的 SPA 回退（也会跳过 `warmup()` 预热）。
- `SSR_ENABLED=0`：等价开关（`lib/ssr.js` 里 `ENABLED = !SPA_ONLY && SSR_ENABLED !== '0'`）。
- 两者都只影响当前进程，`frontend/dist` / `frontend/dist-ssr` / `frontend/prerender` 都不用动，
  去掉环境变量重启即可恢复。
- 单个进程调试时可用 `SSR_BUNDLE=frontend/dist-ssr-s/entry-server.js` 指定某个 SSR 产物做灰度验证。

---

## 5. 如何新增一个 Provider

**第一步：写 `lib/prefetch/<name>.js`。** 文件放进 `lib/prefetch/` 就会被自动注册
（`lib/prefetch/index.js` 扫描目录，不需要改 `lib/ssr.js` 或 `server.js`）。
照着 `lib/prefetch/wiki.js` 的模板写：

```js
// lib/prefetch/example.js
const db = require('../../database');          // 或服务层 require('../wiki')

const SSG = [/^\/example$/];                    // 需要预渲染成静态 HTML 的路由（构建时生成）
const SSR = [];                                 // 需要按请求服务端渲染的路由（与 SSG 二选一或并存）
// const SSR = [/^\/example\/\d+$/];

/** 取数：返回 { [key]: data }，key 必须与页面 useServerData(key) 一致 */
async function load(pathname, ctx = {}) {
    const clean = String(pathname || '').split('?')[0].replace(/\/+$/, '') || '/';
    if (clean !== '/example') return null;

    const row = await db.get('SELECT ... WHERE id = ?', [1]);
    if (!row) return null;                      // 资源不存在 → 交回 SPA，不渲染
    return { exampleHome: { row } };
}

/** SSG 动态路由必须提供：列出所有要生成的完整路径 */
async function enumerate() {
    const rows = await db.all('SELECT slug FROM example');
    return ['/example', ...rows.map(r => `/example/${r.slug}`)];
}

/** 每页 head（可选；不写就退化成站点默认标题） */
function head(data, pathname) {
    return { title: '示例 · 我的世界玄剑公会', description: '……', image: undefined };
}

module.exports = { name: 'example', ssg: SSG, ssr: SSR, load, enumerate, head };
```

写 Provider 的硬性约定：

1. **`name` 唯一**，是日志与 `describe()` 里的标识；`ssg` / `ssr` 至少声明一个（都为空会被忽略并 warn）。
2. **返回的 key 与页面 `useServerData(key)` 一一对应**；数据形状（字段名、排序、分页字段）
   必须与对应 `routes/*.js` 的公开接口一致，否则 hydrate 出来的首屏与客户端请求结果对不上。
3. **不发 HTTP 自请求**，直接 `require('../../database')` 或服务层。
4. **读路径不写库**（不累加 `views`、不改统计）——SSR 有 60 秒缓存，写库会被放大成「每分钟最多一次」。
5. **服务端一律按游客渲染**：不判断登录态（收藏/关注/编辑按钮由客户端 `useEffect` 接管），
   需要 `JWT_SECRET` 的模块不要 `require`（缺变量会 `process.exit(1)`）。
6. **带查询参数的形态由 Provider 决定**：
   - `content-list.js` 的做法：忽略 query，服务端发「无参数首版」，翻页/搜索/排序由客户端接管；
   - `members.js` 的做法：`load()` 里通过 `ctx.req.originalUrl` 判断有 query 就返回 `null`，交回 SPA。
   注意 `lib/ssr.js` 只把 pathname 传给 `load()`，要看 query 必须读 `ctx.req.originalUrl`。
7. **不存在的资源返回 `null`**（草稿、已删除、被封禁、非法转义…），不要抛异常。
8. `head(data, pathname)` 决定 `<title>` / `description` / OG 图；`/` 这类首页允许沿用站点默认标题。

**第二步：接线页面。** 只加「有预取就用、没有才请求」的分支，不重写页面逻辑：

```jsx
import { useServerData } from '../context/ServerDataContext';

export default function Example() {
  const seeded = useServerData('exampleHome');       // 服务端没给就是 undefined
  const [data, setData] = useState(seeded || null);
  const [loading, setLoading] = useState(!seeded);

  useEffect(() => {
    if (seeded) return;                              // 预取命中：跳过首次请求
    api.get('/api/example').then(setData).finally(() => setLoading(false));
  }, [seeded]);
  // …
}
```

已接线的页面与 key：

| 页面 | Provider key | 模式 |
|:---|:---|:---|
| `Home.jsx` | `homeStats` | SSR |
| `PostDetail.jsx` | `postDetail`（`{ post, comments }`） | SSR |
| `ContentList.jsx` | `contentList`（校验 `type` 后使用） | SSG |
| `Projections.jsx` | `projections` | SSG |
| `Profile.jsx` | `profileUser`（`{ user }`）+ `profilePosts`（帖子数组） | SSR |
| `Mods.jsx` | `modsInfo`（纯静态页标识） | SSG |
| `Wiki.jsx` | `wikiHome` + `wikiTree` | SSG |
| `WikiCategory.jsx` | `wikiCategory` + `wikiTree` | SSG |
| `WikiPage.jsx` | `wikiPage` + `wikiTree` | SSG |
| `Gmirs.jsx` / `Gdars.jsx` / `Rankings.jsx` / `Donation.jsx` | `gmirsHome` / `gdarsHome` / `rankingsHome` / `donationHome` | SSR |

**Hydration 安全（必须遵守）**：

- 渲染期不碰 `window` / `document` / `localStorage`（放 `useEffect` 里）；`useServerData()` 只读 context。
- 预取数据只在「与当前 URL 对应」时使用：`PostDetail` 比对 `post.id`、`Profile` 比对 `username`，
  SPA 内部切到别的资源时必须丢弃预取数据，否则会跳过请求、显示上一个资源。
- 首屏状态用同一个 `seeded` 初始化（`useState(seeded ? … : …)`、`useState(!seeded)`），
  并用 `useRef` 标记「预取只消费一次」，避免 SPA 回退后再进入时跳过真实请求。

**第三步：验证。**

```bash
node scripts/prerender.js --clean     # SSG：重新生成静态产物
node scripts/test-ssr.js              # 三层自检（含新路由）
```

---

## 6. 如何重新生成 SSG

在**能访问数据库**的机器上执行（生产上就是服务器本机，SSG 产物必须落在站点可读的 `frontend/prerender/`）：

```bash
node scripts/prerender.js --clean        # 清空旧产物后全量重建（发布/大改后推荐）
node scripts/prerender.js                # 按当前登记的路由重建
node scripts/prerender.js --only=/wiki   # 只重建某个前缀（例如只动过 Wiki）
node scripts/prerender.js --list         # 只打印将要渲染的路径，不渲染
```

- 产物文件名规则见 §2；`prerender.js` 结束时会打印「成功 N / 失败 M」与疑似空壳（<2KB）文件。
- 单个页面内容变更时**不需要**全量重跑：业务代码调用 `invalidate(url)` 删掉那一个文件，
  下次请求会现场渲染并落盘，随后再按需清 CDN 缓存（`scripts/purge-cache.sh`）。
- 漏生成的静态页不会 404：中间件发现文件缺失时会现场渲染并补写产物。

---

## 7. 部署流程

```bash
# ① 构建机：一键构建（客户端产物 + Rocket Loader 补丁 + SSR 产物）
bash scripts/build-frontend.sh
#    = cd frontend && npm run build
#      node scripts/patch-index-bootstrap.js frontend/dist
#      cd frontend && npm run build:ssr

# ② 把以下内容上传到服务器 /root/deploy-render-20261002/
#    dist.tgz（frontend/dist）、normal-dist.tgz（回滚留档）、dist-ssr.tgz（frontend/dist-ssr）
#    backend/（lib/ssr.js、lib/prefetch/、server.js、scripts/*.js 等需要覆盖到站点根的文件）

# ③ 服务器：覆盖后端 → dist 原子切换 → 重启 → 生成 SSG → 逐路由验证
bash scripts/deploy-render-20261002.sh
```

`deploy-render-20261002.sh` 的五个步骤：

1. 备份并覆盖后端文件（`server.js`、`lib/ssr.js`、`lib/wiki.js` …），备份到 `.bak-render-<时间戳>/`；
2. `frontend/dist` 原子切换（`dist.new` → `mv`），保留国庆主题标记，并留档 `dist-normal`；
3. 解包 SSR 产物到 `frontend/dist-ssr/`；
4. `pm2 restart xuanjian-guild --update-env`，然后 `node scripts/prerender.js --clean` 生成 SSG；
5. `check()` 逐路由 `curl`，打印 状态码 / `X-Render-Mode` / 正文长度 / `<title>`
   （`/`、`/wiki`、`/daily`、`/mods`、`/projections`、`/gmirs`、`/rankings`、`/donation`、
   最新的 `/post/<id>` 与 `/profile/<username>`）。

回退：`SPA_ONLY=1 pm2 restart xuanjian-guild --update-env`（见 §4）。
缓存清理：`bash scripts/purge-cache.sh`（见 §3）。

---

## 8. 自检（scripts/test-ssr.js）

发布前在本地跑一遍真实渲染自检（**只读**：不写 `data/guild.db`、不生成 SSG 产物）：

```powershell
node --check scripts/test-ssr.js

cd frontend; npm run build; cd ..
node scripts/patch-index-bootstrap.js frontend/dist
cd frontend; npx vite build --ssr src/entry-server.jsx --outDir dist-ssr-s; cd ..

$env:DB_FILE='data/guild-prod-copy.db'
$env:SSR_BUNDLE='frontend/dist-ssr-s/entry-server.js'
node scripts/test-ssr.js
```

脚本做的事：

| 段 | 断言 |
|:---|:---|
| [1] Provider 注册表 | `lib/prefetch.describe()` 里每个 provider 至少声明了 `ssg` 或 `ssr` |
| [2] 已注册路由 | 站点已知路由 + `enumerate()` + 各 provider 正则反推的样本逐条 `renderUrl()`：非 `null`、HTML ≥ 8KB、含 `__SSR_DATA__`、`<title>` 不是站点默认标题（`/` 豁免），并按需校验真实数据特征串（真实帖子标题 / 成员昵称 / 模组名…） |
| [3] 不存在的资源 | `/post/99999999`、`/wiki/not-exist-slug`、不存在的成员主页必须返回 `null`（交回 SPA） |
| [4] 带查询参数的形态 | 用生产形态 `ctx = { req: { originalUrl } }`：`/rankings?type=contribution`、`/gmirs?keyword=x` 等必须 `null`；provider 有意不看 query 的（`/daily?page=2`）必须与无参数版 HTML 完全一致 |
| [5] 汇总 | `通过 N / 失败 M` + 失败明细；退出码 `0` = 全绿，非 `0` = 有失败 |

- 默认用**只读副本** `data/guild-prod-copy.db`，可用 `DB_FILE` 换库；
- `SSR_BUNDLE` 不指定时自动挑存在的 `frontend/dist-ssr/entry-server.js` 或 `frontend/dist-ssr-*/entry-server.js`；
- **未注册的路由计入「跳过」而不是失败**（某个 provider 还没上线时不会误报）：
  `SSR_TEST_IGNORE_PROVIDERS=members node scripts/test-ssr.js` 可以模拟「members 还没落地」；
- 数据量大时可用 `SSG_TEST_LIMIT=50` 限制 enumerated SSG 路由的校验条数。

单个 URL 的手工抽查：

```powershell
$env:DB_FILE='data/guild-prod-copy.db'; $env:SSR_BUNDLE='frontend/dist-ssr-s/entry-server.js'
node -e "const ssr=require('./lib/ssr');(async()=>{for(const u of ['/profile/zjrmuran','/mods']){const o=await ssr.renderUrl(u,{});console.log(u, o? o.mode+' '+Math.round(o.html.length/1024)+'KB title='+(/<title>([^<]*)<\/title>/.exec(o.html)||[])[1] : '(null → SPA)');}})()"
```

---

## 9. 环境变量

| 变量 | 作用 | 默认 |
|:---|:---|:---|
| `SPA_ONLY` | `=1` 全站回退纯 SPA（见 §4） | 未设置 |
| `SSR_ENABLED` | `=0` 等价于 `SPA_ONLY=1` | `1` |
| `SSR_BUNDLE` | 指定 SSR 产物路径（灰度 / 测试） | `frontend/dist-ssr/entry-server.js` |
| `SITE_URL` | `canonical` / OG / Twitter 卡片的站点前缀 | `https://xuanjian.top` |
| `DB_FILE` | 数据库文件（测试脚本默认用 `data/guild-prod-copy.db`） | `data/guild.db` |
| `SSG_TEST_LIMIT` | `scripts/test-ssr.js`：enumerated SSG 路由校验上限 | `200` |
| `SSR_TEST_IGNORE_PROVIDERS` | `scripts/test-ssr.js`：模拟某些 provider 未落地（路由计入跳过） | 未设置 |

缓存时长常量在 `lib/ssr.js` 顶部：`SSG_TTL_MS = 10 * 60 * 1000`、`SSR_TTL_MS = 60 * 1000`。
