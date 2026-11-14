# 玄剑 GIS API 契约（v1 / contract 1）

> 站点：<https://xuanjian.top> ｜ 基址：`/api/gis` ｜ 版本：`contract=1`（2026-11）
> 面向：Minecraft 客户端（xuanjian-map-mod）、官网前端（`/gis`）、集市地点选择器、XBed 预留。
> 机器可读契约：`GET /api/gis/client/contract`（返回本文档的 JSON 摘要，客户端应以此为准做启动自检）。

通用约定（与全站现有 API 一致）：

- 成功：HTTP 2xx，响应体 `{ "ok": true, ... }`
- 失败：HTTP 4xx/5xx，响应体 `{ "ok": false, "error": "<code>", "message": "<中文说明>", ... }`
- 时间：`YYYY-MM-DD HH:MM:SS`（服务器本地时间，北京时间），另有 `serverTime` 字段。
- 坐标：原版 Minecraft 坐标；2D 几何只用 X/Z，Y 是高度属性。Dimension：`overworld|nether|end|custom`。
- 鉴权：`Authorization: Bearer <token>`。两种 token 都接受：
  - 官网 OAuth 2.0 access_token（客户端用，PKCE 公共客户端，见 `docs/OAUTH.md`）
  - 官网登录 JWT（浏览器用，现有 `/api/auth/login` 签发）
- 分页：`limit`（默认 200，上限 1000）、`page`（1 起）。bbox 接口另有 cursor。

## 错误码表

| error | HTTP | 含义 |
|---|---|---|
| `unauthorized` | 401 | 缺少/无效 token |
| `forbidden` | 403 | 已登录但无权限（含 `required` 字段） |
| `not_found` | 404 | 对象不存在 |
| `invalid_argument` | 400 | 参数缺失/格式错误（含 `field`） |
| `invalid_payload` | 400 | 二进制载荷格式错误 |
| `payload_too_large` | 413 | 超过压缩/解压/尺寸上限 |
| `bbox_required` | 400 | 缺少 bbox（禁止整图查询） |
| `bbox_too_large` | 400 | bbox 面积超上限，请放大缩放级别 |
| `server_not_registered` | 403 | 服务器未在 GIS 注册，不允许上传 |
| `world_not_registered` | 403 | World ID/Key 与服务器绑定不符 |
| `world_archived` | 409 | 世界已归档/快照，禁止写入 |
| `dimension_mismatch` | 409 | Dimension 与注册的世界维度不符 |
| `version_conflict` | 409 | 版本号过期（乐观锁） |
| `duplicate` | 200 | 幂等重放，返回首次结果并带 `duplicate:true` |
| `rate_limited` | 429 | 限流（含 `retryAfter`） |
| `data_unavailable` | 200/404 | 该坐标/区域无高程数据（**必须显式标记，不得当作平地**） |
| `server_error` | 500 | 服务端异常 |

---

## 一、World Registry

世界的创建与状态变更**只能由管理员**完成，客户端不能创建世界。

### `GET /api/gis/worlds`
公开。查询参数：`status`（ACTIVE/ARCHIVED/SNAPSHOT，可逗号分隔）、`serverKey`。

```json
{ "ok": true, "worlds": [{
  "id": 1, "worldKey": "yl-main", "serverKey": "yl", "serverId": "yl",
  "serverName": "樱梨", "mcVersion": "1.21.11", "status": "ACTIVE", "isCurrent": true,
  "description": "",
  "dimensions": [{ "dimension": "overworld", "chunkCount": 15234,
                   "bbox": {"minX": -2048, "maxX": 3072, "minZ": -3072, "maxZ": 2048},
                   "hasElevation": true, "updatedAt": "2026-11-14 12:00:00" }],
  "createdAt": "2026-11-01 00:00:00", "updatedAt": "2026-11-14 12:00:00"
}]}
```

### 客户端侧

#### `GET /api/gis/client/bootstrap?serverKey=yl`
需要登录（`gis.access`）。客户端启动时调用，拿到它被允许上传的世界。

```json
{ "ok": true, "contract": 1, "serverTime": "2026-11-14 12:00:00",
  "server": { "serverKey": "yl", "serverName": "樱梨", "uploadPolicy": "member" },
  "worlds": [{ "id": 1, "worldKey": "yl-main", "status": "ACTIVE", "isCurrent": true,
               "mcVersion": "1.21.11", "dimensions": ["overworld","nether","end"] }],
  "limits": { "maxChunkBatch": 64, "maxCompressedBytes": 4194304, "maxDecompressedBytes": 8388608,
              "maxSampleSize": 32, "maxBboxArea": 16000000, "maxObjectsPerPage": 1000,
              "uploadRatePerMinute": 60, "encodings": ["zstd","gzip","deflate","identity"] },
  "sync": { "endpoint": "/api/gis/client/sync", "cursorField": "cursor" } }
```

#### `POST /api/gis/client/resolve-world`
需要登录。校验「服务器 ↔ 世界 ↔ Dimension」绑定，通过后返回写入用的身份。

请求：`{ "serverKey": "yl", "worldId": 1, "worldKey": "yl-main", "dimension": "overworld" }`

成功：`{ "ok": true, "worldId": 1, "worldKey": "yl-main", "dimension": "overworld",
"writable": true, "worldStatus": "ACTIVE" }`

失败：`server_not_registered` / `world_not_registered` / `world_archived` / `dimension_mismatch`。
校验顺序：注册服务器 → 世界存在且 `server` 一致 → `worldKey` 一致 → 状态 ACTIVE/SNAPSHOT(只读) → dimension 属于该世界已注册维度。

#### `GET /api/gis/client/contract`
公开，返回契约版本、错误码、二进制格式说明、限额。客户端启动时比对 `contract`，不一致则提示更新。

**隐私边界（公开接口审计）**：本接口只暴露契约元信息（版本号、编码/限额、枚举、错误码、端点路径），
**不包含**任何 server token、client_secret、用户隐私或身份数据；世界/服务器只暴露业务必需的 `serverKey`（如 `yl`）。
`/api/gis/worlds`、`/api/gis/config` 同属公开元信息，只列已注册的服务器标识/名称与维度覆盖统计（chunk 数、bbox），
不返回贡献者个人身份；`/api/gis/admin/**` 全部要求 `gis.admin` 权限。

---

## 二、区块地理数据上传（客户端 → 服务端）

只上传「Minecraft 原始可得数据」：高度、biome、方块类型统计、chunk 坐标。**不做任何 GIS 实体推断**。
不上传玩家位置、聊天、身份之外的隐私数据。

### 2.1 上传计划（断点续传）

`POST /api/gis/client/chunks/plan`（`gis.submit`）

```json
{ "worldId": 1, "dimension": "overworld",
  "chunks": [{"x": 0, "z": 0}, {"x": 1, "z": 0}] }
```
响应：
```json
{ "ok": true, "have": [{"x": 0, "z": 0}], "missing": [{"x": 1, "z": 0}],
  "coverage": { "chunkCount": 1, "bbox": {"minX":0,"maxX":0,"minZ":0,"maxZ":0} } }
```
`chunks` 上限 4096 个。客户端据此跳过已上传 chunk，实现增量与断点续传。

### 2.2 批量上传（二进制 + 压缩，禁止大 JSON）

`POST /api/gis/client/chunks?worldId=1&dimension=overworld`

| Header | 必填 | 说明 |
|---|---|---|
| `Authorization` | ✔ | `Bearer <oauth access_token>` |
| `Content-Type` | ✔ | `application/octet-stream` |
| `Content-Encoding` | ✔ | `zstd` \| `gzip` \| `deflate` \| `identity` |
| `Idempotency-Key` | ✔ | 批次幂等键，`[A-Za-z0-9_-]{8,64}`，重试必须复用同一值 |
| `X-GIS-Contract` | 建议 | `1` |
| `X-GIS-Server-Token` | 视策略 | `uploadPolicy='token'` 的服务器必填 |

限额：请求体（压缩后）≤ 4 MiB；解压后 ≤ 8 MiB；单批 chunk 数 1–64；`sampleSize` ≤ 32；限流 60 次/分钟/用户。

**解压后载荷格式**（little-endian）：

```
Header (20 bytes)
  u8[5] magic   = "XJGIS"
  u8    version = 1
  u8    dimensionCode  0=overworld 1=nether 2=end 3=custom
  u8    chunkCount     1..64
  u32   worldId
  u64   batchSeq       客户端单调递增，仅诊断用
Chunk record × chunkCount
  i32   chunkX
  i32   chunkZ
  u8    sampleStep     方块采样间隔 1..4（1=每方块）
  u8    sampleSize     采样矩阵边长，默认 16，上限 32
  i16   minY           本 chunk 实际最小高度
  i16   maxY           本 chunk 实际最大高度
  u8    flags          bit0=heightMatrix, bit1=biomeMatrix, bit2=blockHist
  [flags&1] i16[sampleSize*sampleSize]  heightMatrix（Y 值；-32768 = 该格无数据）
  [flags&2] u16[sampleSize*sampleSize]  biomeMatrix（0xFFFF = 未知）
  [flags&4] u8 n, then n × { u16 blockId, u32 count }
```

说明：
- `heightMatrix` 缺失记为 `-32768`，服务端**保留缺口**（未采集区域），地形分析时显式标记无数据，绝不填 0 或平均高度。
- 同一 `(worldId, dimension, chunkX, chunkZ)` 重复上传为**幂等 upsert**（以最后一次为准），不产生重复行。
- 服务端在同一事务内写入全部 chunk；任一 chunk 校验失败则整批拒绝（`invalid_payload` + `chunkIndex`）。

响应：
```json
{ "ok": true, "batchId": "a1b2c3d4", "duplicate": false, "dimension": "overworld",
  "accepted": 2, "storedChunks": 2, "coverage": { "chunkCount": 3, "bbox": {"minX":0,"maxX":1,"minZ":0,"maxZ":0} },
  "serverTime": "2026-11-14 12:00:00" }
```

### 2.3 已采集覆盖范围

`GET /api/gis/terrain/coverage?worldId=1&dimension=overworld&bbox=minX,minZ,maxX,maxZ`

```json
{ "ok": true, "dimension": "overworld", "coverage": 0.62,
  "chunks": [{"chunkX": 0, "chunkZ": 0, "minY": 62, "maxY": 98, "hasGaps": false}],
  "missing": [{"chunkX": 1, "chunkZ": 0}],
  "bbox": {"minX":0,"maxX":31,"minZ":0,"maxZ":15}, "truncated": false }
```

---

## 三、GIS 对象读取（浏览器/客户端共用）

只返回 **Published Revision**（未发布草稿仅审核权限可见，走 `/admin/*` 接口）。

### `GET /api/gis/objects`
必须给 `bbox`（严禁整世界返回）。

| 参数 | 说明 |
|---|---|
| `worldId` | 必填 |
| `dimension` | 必填 |
| `bbox` | 必填，`minX,minZ,maxX,maxZ`（MC 坐标，含小数） |
| `types` | 可选，`district,road,marker`，默认全部 |
| `limit` | 默认 200，上限 1000 |
| `cursor` | 上一页返回的 `nextCursor` |
| `detail` | `1` 返回完整几何（默认简化几何 `simplify` 由 `zoom` 控制） |
| `zoom` | 可选 0–20，用于几何简化 |

```json
{ "ok": true, "revision": 42, "objects": [
  { "type": "district", "id": 7, "revision": 3, "name": "樱梨城", "status": "PUBLISHED",
    "dimension": "overworld", "geometry": {"type":"Polygon","coordinates":[[[0,0],[100,0],[100,100],[0,100],[0,0]]]},
    "style": {"color":"#5b8def","opacity":0.25,"weight":2},
    "districtType": "city", "parentId": null, "wikiPageId": 12, "description": "..." },
  { "type": "road", "id": 3, "revision": 1, "name": "中央大道", "geometry": {"type":"LineString","coordinates":[[0,0],[500,0]]},
    "width": 7, "roadLevel": 1, "isMain": true, "districtId": 7, "wikiPageId": null },
  { "type": "marker", "id": 11, "revision": 2, "name": "北域酒馆", "category": "shop",
    "point": {"x": 12.5, "y": 68, "z": -30}, "submitterId": 5, "wikiPageId": 33 }],
  "hasMore": true, "nextCursor": "240|11", "truncated": false,
  "serverTime": "2026-11-14 12:00:00" }
```

bbox 面积上限 16,000,000 方块²（约 4000×4000）；超出返回 `bbox_too_large`。

### `GET /api/gis/objects/:type/:id`
`type ∈ {district, road, marker}`。返回当前 Published 版本 + `wikiPageId`；带权限时附 `workingRevision`（草稿状态）。

### `GET /api/gis/objects/:type/:id/revisions` / `.../revisions/:rev`
版本历史与单版本快照（`gis.access`）。

### `GET /api/gis/search`
`?q=&worldId=&dimension=&bbox=&category=&limit=50` — 名称/描述空间+文本搜索（只搜已发布）。

### `GET /api/gis/place?worldId=&dimension=&x=&z=`
点位归属查询（XBed / 集市 / HUD 服务端兜底）：
```json
{ "ok": true, "district": {"id":7,"name":"樱梨城"}, "road": {"id":3,"name":"中央大道","distance": 12.4},
  "nearestMarkers": [{"id":11,"name":"北域酒馆","distance": 40.2}], "hasData": true }
```

### `GET /api/gis/nearby?worldId=&dimension=&x=&z=&radius=128`
半径内对象（只含已发布）。

---

## 四、提交与审核（写接口）

统一状态机：`DRAFT → REVIEW → PUBLISHED → Version N+1`，拒绝 `REJECTED`，归档 `ARCHIVED`。
每次状态变更写 `gis_revisions` 不可变版本记录；发布后写入 `gis_published`（客户端只读这一层）。

| 接口 | 权限 | 说明 |
|---|---|---|
| `POST /api/gis/objects/marker` | `gis.submit` | 玩家提交地点/建筑/住宅/商铺等 Marker，默认直接进入 REVIEW |
| `POST /api/gis/objects/road` | `gis.road.edit` | 绘制道路（LineString + 宽度 + 等级 + 所属城区） |
| `POST /api/gis/objects/district` | `gis.district.edit` | 绘制城区/区域（Polygon + 父级 + 样式） |
| `PUT /api/gis/objects/:type/:id` | 对应编辑权限 | 修改，必须带 `revision`（乐观锁，冲突返回 `version_conflict`） |
| `POST /api/gis/objects/:type/:id/submit` | 编辑权限 | DRAFT → REVIEW |
| `POST /api/gis/objects/:type/:id/publish` | `gis.object.review` | REVIEW → PUBLISHED，`revision+1` |
| `POST /api/gis/objects/:type/:id/reject` | `gis.object.review` | REVIEW → REJECTED（带 note） |
| `POST /api/gis/objects/:type/:id/rollback` | `gis.object.review` | 回滚到指定历史版本，生成新版本 N+1 |
| `DELETE /api/gis/objects/:type/:id` | `gis.admin` | 软删除（ARCHIVED + 客户端 tombstone） |
| `POST /api/gis/objects/:type/:id/wiki` | 编辑权限 | 关联/解除 Wiki 页面（`wikiPageId` 可 null，只存 ID 不复制正文） |
| `GET /api/gis/review/queue` | `gis.object.review` | 待审列表 |
| `GET /api/gis/wiki/:wikiPageId/objects` | 公开 | Wiki 页面反向关联的 GIS 对象 |

Marker 分类（9 类，枚举固定）：`public_building`（公共建筑）、`housing`（住宅）、`shop`（商铺）、
`industry`（工业）、`agriculture`（农业）、`transport`（交通）、`entertainment`（娱乐）、
`government`（政府/组织）、`other`（其他）。
Marker 不存图片；详情/图片放 Wiki，通过 `wikiPageId` 关联。

---

## 五、地形与等高线

全部读取接口公开，计算**异步/按需**，不阻塞普通 API。未采集区域一律显式标记。

| 接口 | 说明 |
|---|---|
| `GET /api/gis/terrain/height?worldId&dimension&x&z` | 单点高程：`{height: 68.0, sampled: true}`；无数据 `{height: null, sampled: false, missing: true, chunkX, chunkZ}` |
| `GET /api/gis/terrain/contours?worldId&dimension&bbox&interval=5\|10\|20\|50\|100&zoom=` | 等高线（真实高程，marching squares）。`{interval, lines:[{level, coordinates:[[x,z],...]}], data:{available, coverage, missingRects:[[minX,minZ,maxX,maxZ]], generatedAt}, cached}`。缩放级别影响抽样步长（`zoom ≤ 3` 时自动放大步长/抬高等距） |
| `GET /api/gis/terrain/grid?worldId&dimension&bbox&resolution=` | 采样网格 `{width,height,step,heights:[int16...],missing:[0\|1...],origin:{x,z}}`（`-32768` 表示无数据），供前端本地画等高线/山体阴影 |
| `GET /api/gis/terrain/slope?worldId&dimension&bbox&resolution=` | 坡度 `{degree:[[...]], min,max,mean, missing}` |
| `GET /api/gis/terrain/profile?worldId&dimension&points=[[x,z],...]&samples=100` | 剖面 `{length, samples:[{x,z,distance,height\|null,hasData}], missingRanges:[[d0,d1]]}` |
| `GET /api/gis/terrain/distribution?worldId&dimension&bbox` | 高程分布直方图 `{bins:[{from,to,count}], min,max,mean,missingChunks}` |
| `GET /api/gis/terrain/stats?worldId&dimension&bbox` | 区域统计 `{count,min,max,mean,p50,p90,stdev,missingChunks,coverage,hasData}` |
| `GET /api/gis/terrain/hillshade?worldId&dimension&bbox&resolution&azimuth&altitude` | 山体阴影强度 `{width,height,intensity:[0-255],missing:[0|1]}`（客户端渲染） |
| `POST /api/gis/terrain/jobs` | 重计算任务（等高线缓存预热、区域统计），`gis.access`；返回 `{jobId}` |
| `GET /api/gis/jobs/:id` / `GET /api/gis/jobs` | 任务状态 |

单次同步请求的 bbox 面积上限：等高线/网格 512×512 方块（超限 400 或改走 jobs）；`distribution`/`stats` 上限 4000×4000。
网页前端在低缩放级别会自动把**中心 512×512 方块**区域作为地形请求范围（其余区域不计算，避免拖垮 2G2H 服务器），
所以低缩放时等高线只覆盖视野中心一块，放大地图即可看到更大范围；未采集区域始终以 `missingRects` 显式标注。

---

## 六、历史地图

| 接口 | 权限 | 说明 |
|---|---|---|
| `GET /api/gis/history/snapshots?worldId` | 公开 | 快照列表 |
| `POST /api/gis/history/snapshots` | `gis.admin` | 创建世界快照（记录各对象当前最大版本，不复制几何） |
| `GET /api/gis/history/at?worldId&dimension&asOf=<ISO8601>\|snapshotId&bbox` | `gis.access` | 按时间/快照重建历史视图（只读） |
| `GET /api/gis/history/diff?worldId&snapshotId&against=<snapshotId\|current>` | `gis.access` | 差异 `{added,removed,changed}` |
| `POST /api/gis/history/archive` | `gis.admin` | 归档世界（ARCHIVED，历史不覆盖当前） |

历史视图从 `gis_revisions` 重建；当前数据不被历史数据覆盖。

---

## 七、地点引用（集市 / XBed 预留）

| 接口 | 说明 |
|---|---|
| `GET /api/gis/places?worldId&dimension&bbox&kind` | 统一地点引用 `[{kind:'market_store'\|'gis_marker'\|'district', refType, refId, name, x,y,z, link}]` |
| `GET /api/gis/places/:kind/:refId` | 单条 |
| `GET /api/gis/market/locations?bbox&serverKey&dimension` | 集市店铺地点（读 `market_store_locations`，不复制数据） |
| `GET /api/gis/market/locations/count` | 数量核对：`{marketLocations, gisPlaces, consistent:true}` |

XBed 预留：`GET /api/gis/places?...` 即为地点引用接口（比赛场地/集合点/地图区域/导航），不改 xbed 仓库。

---

## 八、集市地点选择器替换（v1 已实现）

- `market_store_locations` 仍是**唯一**地点数据源（不新建并行系统）。
- GIS 地图选点 → 后端仍走原 `/api/market/merchant/stores/:id/locations` 与 `/merchant/locations/:id`（字段不变，`server_key`/`dimension`/`x,y,z`/`label`/`note`/`is_public` 全部保留）。
- GIS 新增只读展示：`GET /api/gis/market/locations`，`/gis` 地图上以独立图层显示，空间关联用。
- 旧数据 0 迁移（兼容读取），迁移前后数量核对：`GET /api/gis/market/locations/count` + `scripts/tests/gis-market.js`。

## 九、权限点

`gis.access`（进入 GIS / 读草稿）、`gis.submit`（提交 Marker、上传地形数据）、
`gis.road.edit`（道路）、`gis.district.edit`（城区）、`gis.object.review`（审核发布/回滚）、
`gis.admin`（世界注册、删除、快照、统计）。**全部写接口后端鉴权，前端隐藏按钮不算鉴权。**
