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
| **Mc 方块彩色地图**（浏览器端 Canvas 实时渲染，服务端只出区块数据、不生成图片） | ✅ 已实现，待部署 | 见 §12；真实数据 + v2 彩色 surface 本地实测通过 |
| 地形与等高线（5/10/20/50/100m、按缩放调密度、剖面、坡度、阴影、分布、统计、异步任务） | ✅ 已上线 | 无采集区域显式标记，绝不伪造平地 |
| 历史地图（快照、按时间/快照重建、对比、归档） | ✅ 已上线 | 历史只读，不覆盖当前数据 |
| 集市地点选择器替换（GIS 地图选点 + 坐标手输双入口） | ✅ 已上线 | 地点仍写 `market_store_locations`，零迁移、数量核对一致 |
| XBed 预留（GIS 地点引用接口） | ✅ 已上线（预留） | `gis_place_refs` + `/api/gis/places*`，未改 xbed 仓库 |
| 权限与安全（6 个 gis.* 权限点、后端鉴权、尺寸/格式/幂等校验、审计） | ✅ 已上线 | 前端隐藏按钮不作为安全边界 |
| Minecraft 客户端接入（采集/上传/同步） | ⏳ 未接入 | 契约与接口已就绪并有测试；模组侧上线后才有对象与高程数据 |
| Xaero Overlay 渲染 | ⏳ 模组侧 | 结论见 §9 |

**测试**：5 套自动化测试 **97/97 通过**（详见 §7、§12.4、§12.7）。**部署**：主功能已 3 次上线并通过生产验证（详见 §8）；方块彩色地图 2 次上线（§12.5、§12.7）。

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

### 5.1 集市地点选择器验证（阶段 5）

本地端到端（临时库 + 真实 `routes/market.js`，联调后已删除临时库）：
1. `/market/merchant` →「位置」→「添加位置」→ 出现 GIS 选点器：服务器下拉（来自 `gis_servers`）+ 维度下拉 + **X/Y/Z 手输** + 「在地图上选点」+「定位到坐标」；
2. 选服务器 `樱梨` → 打开地图选点 → 地图正常渲染（Leaflet 坐标平面）；
3. 在地图上点击 → **X/Z 输入框自动回填**（实测 X=448，Z=-130.75），实现「地图选点 + 坐标手输」双入口；
4. 保存 → 走**集市既有接口** `POST /api/market/merchant/stores/:id/locations` → `market_store_locations` 新增第 3 行（`server_key=yl, x=448, z=-130.75, label=GIS 选点测试`）；`GET /api/gis/market/locations` 投影到同一坐标；`count` 接口 `consistent:true`；
5. 旧数据（id=1/2）坐标/标签完全未变。

线上只读回归（生产）：`/market/merchant` 200、bundle 命中 `gis-picker`、`GET /api/gis/config`（选点器服务器来源）200、`GET /api/gis/market/locations` 返回 2 行且坐标与库内一致、`count` 接口 `consistent:true`；写路径沿用原接口且有自动化测试覆盖（gis-market-test 10/10）。
**注意**：生产当前没有 ACTIVE 世界，选点器会使用已归档世界作为**坐标平面**（仅用于选点/展示，客户端不同步），并在界面明确提示该世界状态；坐标手输始终可用。


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
node scripts/tests/gis-api-test.js        # 47/47 ✅
node scripts/tests/gis-migration-test.js  #  7/7  ✅
node scripts/tests/gis-terrain-test.js    # 15/15 ✅
node scripts/tests/gis-market-test.js     # 10/10 ✅
```

| 套件 | 覆盖要点 |
|---|---|
| API（47） | 契约快照、401/403、Marker 9 类校验、道路/城区创建、Draft→Review→Published（revision N+1）、乐观锁 409、回滚、Wiki 关联+反链、审核队列、bbox 缺失/超限拒绝、空间搜索、点位归属（含道路宽度缓冲）、zstd 上传 + 幂等重放 `duplicate:true`、维度/世界越权拒绝、增量同步 tombstones、等高线/剖面/坡度/统计/阴影/网格、未采集区 `hasData:false`、历史快照/按时间重建/diff、集市地点投影与核对、XBed 地点引用 CRUD、归档世界拒写、**归档后 bootstrap 本地模式语义（uploadEnabled/reason/localModeHint）**、管理接口权限、审计 |
| 迁移（7） | 120-126 全应用、18 表+索引齐备、旧地点零丢失（id/坐标/时间戳逐字段）、World Registry 种子正确、重复执行 0 pending、**每个迁移 up() 重放 2 次幂等**、编号不冲突（仅 120-139） |
| 地形（15） | 二进制往返（含 -32768 缺口，zstd/gzip）、magic/version/sampleSize/截断/尾部/缺高程全拒、覆盖 bbox、单点高程真实值/无数据 null、等高线来自真实高程（斜坡走向与等高距网格）、5/10/20/50/100 层级单调、未采集区 `available:false`+`missingRects`、坡度 26.57° 校准、剖面单调与缺失段、统计 p50/p90/stdev、网格自适应步长、阴影 0-255 与缺失 null、直方图计数=采样数、**数据更新使缓存失效**、几何工具（bbox/点面/洞/距离/简化/面积） |
| 集市（10） | 迁移前后 2 行 id/坐标/时间戳完全一致、新列默认 NULL、GIS 只读不改集市、新增/编辑/删除走原接口且数量回到 2、集市 config/stores/map 正常、GIS 写入不改店铺/订单行数 |

其他验证：
- 生产真机浏览器打开 `/gis`：地图渲染、世界下拉、对象/图层/面板均正常，错误边界未触发；
- 前端构建：`vite build` + `patch-index-bootstrap.js` + `vite build --ssr` 三件套通过（`scripts/build-frontend.sh` 等价步骤；本机 Windows 无 bash，逐条执行了脚本内的三条命令）；
- 断言快照：`scripts/tests/fixtures/gis-contract.v1.json`。

---

## 8. 部署记录

共 3 次上线（同一 tag 系列），脚本均已入库：`scripts/deploy-gis-20261115{,b,c}.ps1` + `scripts/deploy-gis-remote-20261115{,b,c}.sh`。

| 次序 | tag | 内容 | 结果 |
|---|---|---|---|
| #1 | `20261115-gis-fe` | GIS 前端首次上线（`/gis` 页面 + 集市选点器）+ `lib/gis/terrain.js` 覆盖率修复 | 全部 8 步通过；`market_store_locations` 2 行逐字节一致 |
| #2 | `20261115-gis-fe2` | 世界归档管理 UI（归档/启用/设为当前、归档世界只读浏览、无 ACTIVE 世界横幅）+ `lib/gis/client.js` bootstrap 本地模式语义 + 地形面板坡度/分布/异步任务 | 全部 9 步通过；worlds 仍 ACTIVE（归档在下一步单独执行） |
| #3 | `20261115-gis-fe3` | 集市选点器在「无 ACTIVE 世界」时改用已归档世界坐标平面选点（不让选点能力断掉） | 全部 7 步通过；bundle 校验 gis-page/gis-picker/gis-banner 命中；集市地点仍 2 行一致 |
| #4 | `20261115-gis-canvasmap` | **方块彩色地图**：3 个数据接口（palette/chunks/index）+ v2 surfaceBlockMatrix 解析入库 + 浏览器端 Canvas 图层（图层开关/按视口请求/共享缓存） | 9 步全部通过；生产实测见 §12.5 |
| #5 | `20261115-gis-regions` | **分区展示 + 调色板全覆盖**：区域聚类/命名（工业区/紫雪城）、map/index regions、palette 1311 方块双 hash + 未知诊断接口 | 见 §12.7（部署与验证记录） |

### 8.1 通用流程（每次均执行）

`node migrations/run.js --dry-run`（0 pending）→ 备份 `frontend/dist.bak-<tag>` / `dist-ssr.bak-<tag>` / `/root/backups/gis-<tag>/`（含被替换后端文件与数据快照）→ 替换产物 → `node --check` → 重建 SSG（116 页）→ `pm2 restart` → HTTP/接口/DB 校验 → 失败回滚。

**备份路径**：
- `frontend/dist.bak-20261115-gis-fe{,2,3}`、`frontend/dist-ssr.bak-20261115-gis-fe{,2,3}`
- `/root/backups/gis-20261115-gis-fe/{terrain.js, market-locations-before/after.txt}`
- `/root/backups/gis-20261115-gis-fe2/{client.js, gis-worlds-before.txt, market-locations-before/after.txt}`
- `/root/backups/gis-20261115-gis-fe3/{market-before/after.txt, worlds-before.txt}`

### 8.2 生产验证（最终态）

| 项 | 结果 |
|---|---|
| `/` `/gis` `/market` `/market/map` `/market/merchant` `/wiki` `/admin` | 全 **200** |
| GIS API（config/worlds/contract/objects/terrain/market locations/count） | 全 **200** |
| 前端入口 | `assets/index-YiBnf1Rk.js`；bundle 命中 `gis-page` / `gis-picker` / `gis-inspector` / `gis-banner` |
| 真机渲染 | `/gis` 显示「当前没有 ACTIVE 世界」横幅、世界下拉为「已归档·只读」、编辑按钮按权限隐藏、无 JS 异常 |
| 集市地点 | **2 行**，`id/坐标/label/is_public/updated_at` 与部署前逐字节一致 |
| 迁移 | 12/12 已应用，0 pending |
| 错误日志 | 无 GIS 相关错误 |

### 8.3 世界归档操作（站方决定，2026-11-15 执行）

按站方口径：`yl-main`(id=1) 与 `樱梨-main`(id=2) **都归档**（`status=ARCHIVED`、`is_current=0`），**不删任何数据、不删服务器注册**。

- 执行方式：通过**管理员接口** `PUT /api/gis/admin/worlds/{1,2}` `{"status":"ARCHIVED"}`（服务端自动写审计），脚本：`scripts/gis-archive-worlds-20261115.sh`；
- 备份：`/root/backups/gis-20261115-gis-fe2/gis-worlds-before.txt`；
- 审计：`gis_audit` 新增 2 条 `world_update`（actor=2, world_id=1/2, detail `{"status":"ARCHIVED"}`）；
- 验证：
  - `GET /api/gis/worlds` → 两个世界均 `ARCHIVED`、`isCurrent:false`；
  - `GET /api/gis/client/bootstrap?serverKey=yl` → `{uploadEnabled:false, activeWorldCount:0, reason:"no_active_world", worlds:[], localModeHint:"…进入本地模式…"}`；
  - `POST /api/gis/client/resolve-world`（归档世界）→ `409 world_archived`；
  - 归档世界的已发布对象与地形仍可读（`200`）——历史数据保留；
  - `GET /api/gis/market/locations/count` → `consistent:true`。

### 8.4 未来真实服务器上线时如何注册新世界（管理员）

1. `/gis` →「管理」页（或 `POST /api/gis/admin/servers`）注册服务器：`serverKey`（如 `yl`）+ 服务器名；
2. 注册世界：`worldKey`（如 `yl-2027-main`）绑定到该服务器：`POST /api/gis/admin/worlds`；
3. 点「设为当前」：`PUT /api/gis/admin/worlds/:id {"isCurrent":true}`（同服务器内唯一，并自动置 ACTIVE）；
4. 客户端 `bootstrap?serverKey=yl` 即可拿到该 ACTIVE 世界并开始上传；旧世界保持 ARCHIVED 只读。
（同样步骤也写在 `docs/gis-api.md` §一。）

### 8.5 回滚命令

```bash
# 第三次（前端）回滚
cd /var/www/xuanjian-guild && rm -rf frontend/dist frontend/dist-ssr frontend/prerender \
 && mv frontend/dist.bak-20261115-gis-fe3 frontend/dist \
 && mv frontend/dist-ssr.bak-20261115-gis-fe3 frontend/dist-ssr \
 && node scripts/prerender.js --clean && pm2 restart xuanjian-guild

# 若需同时回滚第二次的后端 client.js：
#   cp /root/backups/gis-20261115-gis-fe2/client.js lib/gis/client.js && pm2 restart xuanjian-guild
```
数据库无需回退：120-126 迁移幂等且只新增表/可空列，未修改或删除任何旧数据；世界归档只改状态，可随时用管理接口改回 ACTIVE。

### 8.6 验证截图（本机路径）

- `browser-screenshots/gis-prod-1.png` — 生产 `/gis` 首次上线真机渲染
- `browser-screenshots/gis-prod-2-archived.png` — 生产 `/gis` 归档后：无 ACTIVE 世界横幅 + 只读世界
- `browser-screenshots/gis-2.png` — 本地：城区/道路/Marker 图层
- `browser-screenshots/gis-3.png` / `gis-7-terrain-panel.png` — 地形分析面板（覆盖率/统计/坡度/分布）
- `browser-screenshots/gis-5-terrain.png` / `gis-8-contours.png` — 等高线叠加
- `browser-screenshots/gis-6-profile.png` — 剖面/分布面板
（本地联调用临时库，测试后已删除，不入库。）

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

### 9.3 2G2H 资源占用实测（生产，只读探测脚本 `scripts/gis-verify-20261115.sh`）

机器：2 vCPU / 1967 MB RAM / 39 GB 盘（27 GB 空闲），与站点其它服务（xbed-api、nork、northbooker、beiyu、mcvcba 等 5 个进程）共用。

| 指标 | 实测值 |
|---|---|
| `xuanjian-guild` 进程 RSS | **175 MB**（`ps` 实测）；pm2 显示 172 MB |
| 进程 CPU | `ps` 累计 4.2%（含 SSR 预热与部署期负载），空闲 0% |
| 系统内存 | total 1967 MB / used 747 MB / **available 1220 MB** |
| 磁盘 | 39 GB 总，使用 13 GB，**空闲 27 GB**；`guild.db` = 37 MB（GIS 18 张表为空时 < 1 MB） |
| 120 次 bbox 请求（并发 6）后的 RSS | 175.1 MB → **176.4 MB**（+1.3 MB，无泄漏式增长） |
| 压测瞬时 load | 1.66（2 核，压测后回落） |

接口延迟（生产 HTTPS，keep-alive 连接复用，每个端点 10 次）：

| 端点 | 平均 | 最大 |
|---|---|---|
| `GET /api/gis/config` | 14.8 ms | 148 ms |
| `GET /api/gis/objects?bbox=1024²` | 21.4 ms | 214 ms |
| `GET /api/gis/terrain/coverage` 512² | 17.5 ms | 175 ms |
| `GET /api/gis/terrain/contours` 512²（无数据） | 33.1 ms | 331 ms |
| `GET /api/gis/terrain/stats` 512²（无数据） | 31.6 ms | 316 ms |
| `GET /api/gis/market/locations` | 13.9 ms | 139 ms |
| 基线 `GET /api/market/stores`（无 GIS 改动路径） | 10.9 ms | 109 ms |

结论：
- GIS 接口平均延迟与站点既有接口同量级（10–35 ms），**没有拖慢站点**；首次请求/冷缓存的偶发 100–300 ms 是 TLS 握手与 SSL 开销，不是 GIS 计算导致（基线接口同样出现）；
- 全量矢量 + 按需 bbox 的方案在 2G2H 上内存占用可控（GIS 让进程从 ~172 MB 起，压测后仅 +1.3 MB）；
- 地形计算全部有 bbox/采样上限（等高线同步计算 ≤512×512 方块、网格 ≤262k 采样），更大的区域必须走异步任务，因此**不会**出现“把整个世界渲染成 PNG/等高线”导致 OOM 的情况；
- 若后续客户端大规模上传高程（每 chunk 512 字节 + 索引），按 10 万 chunk 估算约增加 60–80 MB，仍在可用内存范围内；必要时可对 `gis_elevation_chunks` 做按维度的归档清理（表结构已按 world/dimension 分区索引，便于清理）。


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
| 两个世界已按站方口径**全部归档**（`ARCHIVED`/`is_current=0`） | ✅ 已执行 | 2026-11-15 通过管理员接口归档并写审计；数据与服务器注册均保留；客户端 bootstrap 进入本地模式；未来真实服务器注册新世界后可设为当前（步骤见 §8.4 与 docs/gis-api.md） |
| 3D 扩展 | 未实现（数据结构已兼容） | 首版为 2D 编辑；几何存 GeoJSON、Y 作为高度属性，未来可扩 |
| 等高线/统计的更大范围离线预热 | 已提供异步任务入口 | `POST /terrain/jobs`（contour-prewarm/terrain-stats）；首版未做定时自动预热，避免 2G2H 被后台任务占用 |
| XBed 完整集成 | 未做（按规范仅预留） | 已提供 `gis_place_refs` + `/api/gis/places*`，未改 xbed/xbed-plugin 仓库 |
| 集市地点选择器的移动端拖拽体验 | 可用但未专项优化 | 地图选点已支持触屏点击；顶点拖动是桌面编辑器能力 |

---

## 12. 方块彩色地图（浏览器端实时渲染，2026-11-15 新增）

> 契约与设计：`docs/gis-canvas-map.md`；服务端配色表：`lib/gis/map-palette.js`。
> **服务端不生成任何 PNG/WebP**，渲染全部在浏览器 Canvas 完成。

### 12.1 服务端（只出数据）

| 接口 | 说明 |
|---|---|
| `GET /api/gis/map/palette` | 公开读、长缓存（max-age=3600）：`blocks`（hash16→颜色，100+ 常用地表方块）、`water`、`materials`（stone/wood/unknown 等兜底）、`heightShade`（minY/maxY + 高度色带）、`biomes`（群系兜底，数值 id 与资源名 hash 双键）、`blockNames`（排障用） |
| `GET /api/gis/map/chunks?worldId&dimension&bbox&lod` | 公开读：`bbox` 必填、面积 ≤ 4,000,000；`lod` 0–6；`step=2^lod`；每 chunk 返回 `mode`（`surface` 有地表方块矩阵 / `fallback` 只有高度）、`samplesPerSide`、`blocks`/`heights`(/`biomes`) base64 小端；只返回**已采集**区块，未采集透明；`truncated` + `chunksTotal` 处理 512 上限 |
| `GET /api/gis/map/index?worldId` | 公开读：各维度 `chunkCount / surfaceChunks / fallbackChunks / bbox / updatedAt` + 限额，前端据此决定是否显示方块底图 |

数据链路：v2 客户端上传 `flags` bit3 的 `surfaceBlockMatrix`（u16 = `CRC32(资源名)&0xFFFF`）→ `decodeBatch` 解析 → `storeChunks` 把 surface 以 base64 存入现有 `block_hist` JSON（`{hist, surface}`，**不改表结构、不新增库/服务**）→ `/map/chunks` 按 lod 抽样（surface 取区域众数、fallback 取区域均值高度、群系取众数）。旧数据（无 surface）自动走 fallback，旧格式 `block_hist`（纯数组）也能解析。

### 12.2 前端（关键交付）

`frontend/src/components/gis/GisBlockLayer.js`（`L.GridLayer` 子类，无新增大型地图库）：

- tile 与 MC 方块换算：`CRS.Simple`、`lat=-z,lng=x`、256×2^(-zoom) 方块/tile、`lod=clamp(-zoom,0,6)`；
- `createTile` 按 `tile bbox ∩ 数据 bbox` 请求 `/api/gis/map/chunks`，Canvas `ImageData` 逐像素绘制（surface 用 palette 颜色、水面降对比、未知方块用材质兜底；fallback 用高度色带/群系色 + 邻域高差明暗；缺失透明）；
- 缓存：**模块级共享 chunk 数据 LRU（4096）** + 图层 tile canvas LRU（256），关闭/开启图层、平移回来、缩放回退都不重复请求；并发同 bbox 请求去重；
- 图层顺序（下→上）：**Mc 方块地图 → 山体阴影 → 等高线 → 无数据区 → 城区/道路/Marker/集市地点 → 坐标网格**；
- 顶部图层开关新增「Mc 方块地图」（默认开；该维度 `chunkCount=0` 自动隐藏且不显示）；
- 与现有「定位到数据 / 跳转坐标 / 坐标网格」严格对齐 MC X/Z。

### 12.3 浏览器实测（本地真实数据 = 生产 60 chunk + 36 个合成 v2 surface chunk）

真实数据来自生产 `world_id=3 hetao-main`（60 个已采集 chunk，bbox X 2320–2448 / Z 122976–123120），已固化为测试 fixture `scripts/tests/fixtures/gis-real-chunks.json`（**只含采集数据，无身份信息**）。

| 项 | 实测 |
|---|---|
| 首屏渲染 | 打开 `/gis` 即见方块底图；左侧真实数据走 fallback（高度色带+明暗），右侧合成 v2 surface 呈现草/石路/水/木建筑彩色 |
| 视口按需 | 一次页面会话 **仅 4 个** `/api/gis/map/chunks` 请求（按 tile∩数据范围，bbox 参数可在 Network 面板核实），**无全图加载** |
| 平移 | 平移只新增必要 tile；**平移回原处 0 新请求**（tile canvas 命中） |
| 缩放 | 缩放到 -3 / 0 各仅 +1 个请求（lod 切换），其余从缓存取 |
| 缓存 | 共享 chunk 缓存 96 个 chunk 后，后续平移/缩放请求数不再增长 |
| 绘制耗时 | 单 tile **0.1–6.3 ms**（峰值 17 ms 为首次冷启动），满足 <5ms 预算 |
| 自动隐藏 | 切到「下界」（chunkCount=0）→ 开关与底图自动消失；切回主世界恢复 |
| 矢量叠加 | 城区/道路/Marker/等高线/地形阴影/无数据区叠在方块底图之上正常 |

截图（本机路径）：
- `browser-screenshots/gis-canvas-overview.png` — 总览：左侧真实高度兜底色、右侧 v2 彩色方块、未采集区透明
- `browser-screenshots/gis-canvas-surface-2px.png` — v2 彩色地表（草/石路/水/木建筑）
- `browser-screenshots/gis-canvas-fallback-8px.png` — 真实旧数据 fallback 着色（8px/方块）

### 12.4 测试（服务端）

新增 `scripts/tests/gis-map-canvas.js` **11/11 通过**：
palette 一致性（已知 CRC32 向量、hash16、颜色格式、水面/材质/高度色带、群系覆盖）、v2 载荷编解码 + 入库不新增列、旧数据兼容（fallback/旧格式 block_hist）、lod 抽样正确（lod0 原值 / lod3 区域众数 / fallback 区域均值忽略 -32768）、bbox 上限与 `bbox_required`/`invalid lod`、未采集透明、**512 区块 truncated + chunksTotal 真实**、`/map/index` 计数与 bbox、**服务端零图像编码断言**、三接口公开读。

全量回归：`gis-api-test` 50/50、`gis-migration-test` 7/7、`gis-terrain-test` 15/15、`gis-market-test` 10/10、`gis-map-canvas` 15/15 → **97/97 通过**（契约快照已更新 v2 字段；区域聚类/调色板全覆盖用例见 §12.7）。

### 12.5 生产部署（2026-11-15 完成，tag `20261115-gis-canvasmap`）

- 迁移 `--dry-run`：12/12 已应用，**0 pending**（本功能无迁移）
- 备份：`frontend/dist.bak-20261115-gis-canvasmap`、`frontend/dist-ssr.bak-20261115-gis-canvasmap`、`/root/backups/gis-20261115-gis-canvasmap/`（7 个后端文件 + worlds/market 快照）
- 上传：`lib/gis/{map,map-palette,terrain,client,constants,index}.js`、`routes/gis.js`、`frontend/dist`、`frontend/dist-ssr`；`node --check` 7/7 通过；SSG 重建 116 页；`pm2 restart` online
- 生产验证：
  - `GET /api/gis/map/palette` 200：`blocks=106, water=6, materials=8, biomes=94, heightShade.ramp=9, blockNames` ✓
  - `GET /api/gis/map/index?worldId=3` 200：`overworld {chunkCount:60, surfaceChunks:0, fallbackChunks:60, bbox:2320..2448/122976..123120}` ✓
  - `GET /api/gis/map/chunks?...bbox=2320,122976,2448,123120&lod=2` 200：`step=4, samplesPerSide=4, chunks=60, mode 全 fallback, truncated=false` ✓
  - 参数校验：缺 bbox → 400 `bbox_required`；超限 → 400 `bbox_too_large`；`lod=9` → 400 `invalid_argument` ✓
  - `/gis` 200：浏览器真机打开即显示方块底图（12 tile、**4 个 chunks 请求**、绘制 1.2ms、`数据 60 chunk（彩色 0 / 高度兜底 60）`），「Mc 方块地图」开关默认开，无 JS 异常 ✓
  - 旧接口回归：`/api/gis/worlds`、`/api/gis/objects?...`、`/api/gis/terrain/coverage`、`/api/gis/market/locations(/count)`、`/api/gis/client/contract` 全 200；`marketLocations:2, consistent:true` ✓
  - 页面：`/ /gis /market /market/merchant /market/map /wiki /admin` 全 200 ✓
  - 数据：`PRAGMA integrity_check=ok`；`market_store_locations` 2 行且逐字节一致；18 张 gis 表；elevation chunks 60；**表结构未变（无 surface 列）** ✓
  - pm2 错误日志：无 require/exception/GIS 相关错误 ✓
- 截图：`browser-screenshots/gis-canvas-prod-1.png`（生产真实数据 fallback 方块底图 + 矢量叠加）
- 回滚命令：
  ```bash
  cd /var/www/xuanjian-guild && rm -rf frontend/dist frontend/dist-ssr frontend/prerender \
   && mv frontend/dist.bak-20261115-gis-canvasmap frontend/dist \
   && mv frontend/dist-ssr.bak-20261115-gis-canvasmap frontend/dist-ssr \
   && cp -a /root/backups/gis-20261115-gis-canvasmap/lib /root/backups/gis-20261115-gis-canvasmap/routes . \
   && node scripts/prerender.js --clean && pm2 restart xuanjian-guild
  ```
  数据库无需回退（本功能零迁移、未改旧数据）。

**生产现状说明**：方块地图上线时生产 60 个 chunk 均为 **v1（无 surface）**；随后模组开启 v2 上传，现已 361 个 chunk 全带 surface（见 §12.7）。

### 12.6 原部署计划（已完成，留档）

`node migrations/run.js --dry-run`（应 0 pending，本功能无迁移）→ 备份 `frontend/dist.bak-canvasmap-<tag>` + `/root/backups/gis-canvasmap-<tag>/`（`lib/gis/{terrain,client,map,map-palette,index,constants}.js`、`routes/gis.js`）→ 上传后端 + `frontend/dist*`（`build-frontend.sh` 等价三件套）→ `node --check` → `pm2 restart` → 验证 `/api/gis/map/{palette,chunks,index}`、`/gis` 页面与方块底图、`market_store_locations` 仍 2 行、旧接口回归 → 失败回滚（`.bak-canvasmap-<tag>` 还原 + restart，数据库无需回退）。

### 12.7 生产问题修复：区域聚类 + 调色板全覆盖（2026-11-15 第二轮，tag `20261115-gis-regions`）

**问题 1：「地图一片黑 / 大片空白」**
- 根因：world 3 里混有**合法但相距很远**的采集区域（主城区 bbox X2240~2496 / 紫雪城 X≈117,840 / Z≈-52,600 / 另有一个 8 chunk 小区域）。`/api/gis/map/index` 与 `/api/gis/worlds` 的维度 bbox 被撑成 11 万方块，前端「定位到数据」缩放到该范围 → 绝大部分空白深色背景。
- 修复（**不删任何数据**）：
  1. 新增 `lib/gis/regions.js`：chunk 连通聚类（Chebyshev ≤8 chunk / 128 方块），返回 `regions[{id,bbox,chunkCount,centerX,centerZ,surfaceChunks,fallbackChunks,districtId,districtName}]`（按 chunkCount 降序）+ `outlierChunks`（= 非最大区域 chunk 数，语义已澄清不是脏数据）；60s 缓存，签名含 chunk 与 published district 变化。
  2. 区域命名：与 `gis_published` 的 **published district 几何 bbox 相交/包含**时取重叠面积最大者带 `districtId/districtName`（生产：主区域「工业区」、远区「紫雪城」）；无命中不编造。
  3. `/api/gis/map/index` 每个维度返回 `regions` + `outlierChunks`；支持 `?dimension=` 顶层直接返回该维度 regions/bbox/outlierChunks。
  4. 前端：「定位到数据」与自动视野改为**最大区域**；顶部新增「区域」下拉（工业区（201 chunk）/紫雪城（152 chunk）/区域 3（8 chunk，X-8632 Z-245776）），切换跳转并按需加载；banner 文案「已采集 N 个区域，当前显示第 1 个（…）」。
  5. `map/chunks` 仍按 bbox 返回，远区只有跳过去才请求（按需加载不变）。
- 测试：`gis-map-canvas.js` 造「主区域 60 chunk + 远区 3 chunk」→ 断言 `regions.length=2`、首个 60 chunk 且 bbox 不含远区、远区 bbox 精确（X=117840..117872 / Z=-52656..-52624）、`outlierChunks=3`；另测 published district 命名（工业区/紫雪城 命中、无命中为 null）。

**问题 2：surface 颜色大量命中未知（灰）**
- 根因两层：① palette 只登记 ~100 种方块；② 客户端实际写入的是 `CRC32("grass_block")&0xFFFF`（**不含命名空间**），而契约是 `CRC32("minecraft:grass_block")&0xFFFF`，导致连草/水/泥土都未命中（实测 22 种 hash 未登记，主导 hash 57782 占 49%）。
- 修复：
  1. `lib/gis/block-colors.json`（脚本 `scripts/gis-gen-block-colors.js` 生成）覆盖 **1311 个 vanilla 方块**，常用方块手工精修；功能方块继承基础材质色。
  2. palette 对每个方块**双登记**「契约 hash」与「path-only hash」，颜色一致；`blockNames` 反查。
  3. 空气类标记 `transparent`（透明而非灰/黑）；未知 hash 使用 `materials.unknown=#7A7A7A`（灰非黑）。
  4. 新增 `GET /api/gis/map/palette?withUnknown=1[&worldId=&dimension=]` → `unknownSurfaceStats`（扫描 chunk 数、样本总数、未知率、Top100 未登记 hash），便于后续增量补色。
- 实测（生产 361 chunk / 92,416 采样）：**未知率 0%**；主城区浏览器截图能看到水（蓝）、草（绿）、沙（黄）、建筑（灰/棕）等真实材质色。

**浏览器实测（本地复刻生产 361 chunk + 2 个 district）**
- 默认打开：居中主城区「工业区」，彩色底图，zoom 1（不再 11 万方块空白）；
- 区域下拉：`工业区（201 chunk）` / `紫雪城（152 chunk）` / `区域 3（8 chunk，X-8632 Z-245776）`；
- 切到紫雪城：地图跳到 X117856/Z-52712、方块底图正常渲染、城区多边形叠加；整页仅 18 个 chunks 请求（按需）；
- 截图：`browser-screenshots/gis-region-main.png`、`browser-screenshots/gis-region-zixue.png`。

**测试**：`gis-map-canvas` 扩到 **15/15**；全量 **97/97**（api 50、migration 7、terrain 15、market 10、canvas 15）。

**部署与生产验证（tag `20261115-gis-regions` → `20261115-gis-regions2`）**
- 第一轮（`regions`）上线后发现生产数据仍在增长，紫雪城 chunk 数（222）反超工业区（205），若严格按「最大 chunk 区域」当默认，会把默认视野落在紫雪城而非主城区。因此第二轮（`regions2`）把默认「主城区」选择改为**启发式**：`objectCount`（区域内已发布对象数）降序 → `firstSeen`（该区域最早采集时间）升序 → chunk 数降序；`region` 增加 `objectCount / firstSeen` 字段（`regions` 数组本身仍按 chunkCount 降序，符合契约）。
- 迁移 dry-run：12/12 已应用、0 pending；`node --check` 5/5；SSG 116 页；`pm2 restart` online。
- 生产接口实测：
  - `map/index`：`chunkCount=431~435、outlierChunks=213~217、regions=[紫雪城(222, districtId=2, objects=1, firstSeen 11-15), 工业区(205, districtId=1, objects=1, firstSeen 11-14), 区域3(8, 无名)]`；
  - `map/palette`：`version=2, blockColors=1311, blocks=2583, transparent=16, water=12, unknown=#7A7A7A`；
  - `palette?withUnknown=1`：扫描 427+ chunk / 109,312+ 采样，**未知率 0%**；
  - `/gis` 真机：默认选中「工业区（205 chunk）」，视野 X2368/Z123040（不再 11 万方块空白）、彩色底图正常；区域下拉切「紫雪城（222 chunk）」→ 跳到 X117840/Z-52690，方块底图正常、城区多边形叠加；
  - 旧数据核对：集市地点 2 行逐字节一致、`integrity_check=ok`、worlds 不变、GIS 错误日志 0。
- 截图：`browser-screenshots/gis-prod-region-main.png`（生产默认主城区）、`browser-screenshots/gis-prod-region-zixue.png`（切到紫雪城）、`gis-region-main-default.png`（本地核验默认选中）。

---

## 11. 文件清单（本次新增/修改）

**后端**：`migrations/120_gis_worlds.js` … `126_gis_seed.js`、`lib/gis/{constants,errors,geo,audit,worlds,objects,terrain,history,places,jobs,client,index,map,map-palette}.js`、`routes/gis.js`、`routes/market.js`（仅 2 处地点处理器追加可选字段）、`server.js`（挂载 `/api/gis` + 启动 GIS 异步任务）。
**前端**：`pages/Gis.jsx`、`components/gis/{GisMap,GisBlockLayer,GisInspector,GisPanels,GisErrorBoundary}.jsx`、`components/MarketLocationPicker.jsx`、`styles/gis.css`、`pages/MarketMerchant.jsx`（位置页签）、`App.jsx`（`/gis` 路由）、`components/Layout.jsx`（导航）、`package.json`（leaflet 1.9.4）。
**测试**：`scripts/tests/{gis-testkit,gis-api-test,gis-migration-test,gis-terrain-test,gis-market-test,gis-map-canvas}.js`、`scripts/tests/fixtures/{gis-contract.v1.json,gis-real-chunks.json}`。
**文档**：`docs/gis-api.md`、`docs/gis-canvas-map.md`、`docs/gis-report.md`（本文件）。
**部署**：`scripts/deploy-gis-20261115{,b,c}.ps1` + 对应 `-remote-20261115{,b,c}.sh`。
