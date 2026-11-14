# 玄剑 GIS 方块彩色地图瓦片契约（v1）

> 目标：在 Minecraft 客户端完成「方块级彩色地图」渲染，切瓦片上传；官网只存储、分发、展示。
> 本文是 `xuanjian-map-mod`（客户端渲染/切片/上传）与 `xuanjian.top`（存储/分发/网页底图）之间的唯一契约。
> 坐标系与现有 GIS 完全一致：Minecraft 原生 X/Z，1 单位 = 1 方块；网页用 Leaflet `CRS.Simple`，`lat = -z, lng = x`。

---

## 1. 瓦片金字塔

| 参数 | 值 |
|---|---|
| 瓦片尺寸 | 256 × 256 px（WebP，质量 80；不支持 WebP 的客户端回退 PNG） |
| LOD 定义 | `blocksPerPixel = 2^lod`，`lod ∈ [0, 4]` |
| 瓦片覆盖 | `256 × 2^lod` 方块 |
| 瓦片索引 | 方块坐标 `bx,bz` → `tx = floor(bx / (256 * 2^lod))`，`tz` 同理 |
| 像素对齐 | 瓦片内像素 `(px, pz)` 对应方块 `(tx*256*2^lod + px*2^lod, tz*256*2^lod + pz*2^lod)` |

LOD 0 = 1 方块/像素（最精细）；LOD 每 +1，覆盖范围翻倍。客户端同时上传 LOD 0..3（LOD 4 可选）。

**Leaflet 映射**：`leafletZoom = -lod`（`CRS.Simple` 下 zoom 0 = 1px/方块）。
网页地图 `zoom > 0`（放大到 1 方块以上像素）时复用 LOD 0 瓦片由 Leaflet 放大显示（`maxNativeZoom = 0`）。

**维度**：`overworld` / `nether` / `end` / `custom`，各自独立瓦片空间，互不共用。

---

## 2. 存储路径

服务端本地磁盘（2G2H 足够，按需扩展）：

```
/var/www/xuanjian-guild/data/gis-tiles/<worldId>/<dimension>/L<lod>/<tz>/<tx>.webp
```

HTTP 访问（公开读，带长缓存）：

```
GET /api/gis/tiles/<worldId>/<dimension>/L<lod>/<tz>/<tx>.webp
```

---

## 3. 上传接口

```
POST /api/gis/tiles?worldId=<id>&dimension=<overworld|nether|end|custom>&lod=<0-4>&tx=<int>&tz=<int>
Authorization: Bearer <OAuth2 access_token>
Content-Type: image/webp        （或 image/png，服务端按 Content-Type 落盘后缀）
Content-Encoding: identity
Idempotency-Key: <sha256(瓦片字节)[0..32]>   （8-64 字符，重试必须复用）
X-GIS-Contract: 1
```

规则：

- 权限：`gis.submit`（普通成员默认拥有，见权限体系）
- 世界校验：`worldId` 必须存在、属于请求者的 `serverKey` 绑定、状态 `ACTIVE`（归档世界拒绝写入 → `world_archived` 409）
- 尺寸：单瓦片 ≤ 512 KiB，必须能解码为 256×256（允许 PNG/WebP）
- **幂等**：同 `(worldId, dimension, lod, tx, tz)` 以 `sha256` 判定；内容相同 → `{ok:true, duplicate:true, url}`，不重复写盘
- 覆盖语义：同一瓦片再次上传即「更新」（内容变化时才写盘并更新 hash）
- 限流：60 次/分钟/用户（`rate_limited` 429 + `retryAfter`）
- 成功响应：

```json
{ "ok": true, "worldId": 3, "dimension": "overworld", "lod": 0, "tx": 145, "tz": 7688,
  "hash": "ab12…", "bytes": 18342, "duplicate": false,
  "url": "/api/gis/tiles/3/overworld/L0/7688/145.webp" }
```

错误码沿用现有约定：`unauthorized(401) forbidden(403, required) invalid_argument(400) invalid_payload(400) payload_too_large(413) world_not_registered(403) world_archived(409) rate_limited(429) server_error(500)`。

---

## 4. 客户端查询接口

**覆盖度**（客户端决定上传哪些瓦片 / 网页决定底图状态）：

```
GET /api/gis/tiles/coverage?worldId=3&dimension=overworld&lod=0&bbox=minX,minZ,maxX,maxZ
→ { ok:true, worldId, dimension, lod,
    tiles:[{tx,tz,hash,bytes,updatedAt}],
    missing:[{tx,tz}], bbox, truncated }
```

**世界/维度索引**（网页加载底图前判断是否有瓦片）：

```
GET /api/gis/tiles/index?worldId=3
→ { ok:true, worldId,
    dimensions:{ overworld:{ lods:[0,1,2,3], tileCount:123, bbox:{minX,minZ,maxX,maxZ}, updatedAt },
                 nether:{...}, end:{...} } }
```

---

## 5. 客户端渲染规则（建议，非强制协议）

- 每个方块取**顶层非空气方块**的颜色作为该列像素颜色；乘上按高度/朝向的轻微明暗（±8%），避免整片纯色
- 颜色表由客户端内置（草方块 #7CBD4C、石头 #8A8A8A、水 #3B6FD4、沙 #E0D6A8、原木 #6B4F2A、树叶 #4E8B33、木板 #B08A4A、石砖 #9A9A9A、泥土 #8B6B4A、深板岩 #57575F、雪 #F2F7FA 等，可配置）
- 水面统一按水色并降低明暗对比；岩浆按橙色
- 未加载/未采集的列保持透明（`alpha=0`），不要用黑色或平地填充
- 只渲染玩家实际到过的区块；区块被修改后标记该瓦片为 dirty，重新渲染
- 渲染与编码在后台线程完成，不阻塞 Minecraft 主线程；单瓦片渲染目标 < 50ms

---

## 6. 增量与断点续传

1. 客户端按 `(worldId, dimension)` 拉 `coverage?lod=0`，得到已存在瓦片 hash
2. 对本地 dirty 且 hash 不同的瓦片逐一上传（并发 ≤2，指数退避 1s→60s，429 读 `retryAfter`）
3. 上传成功记录 hash，失败保留在队列；重启后继续
4. 同一瓦片内容未变（hash 相同）不发请求

---

## 7. 网页底图接入（xuanjian.top）

- `/gis` 世界地图新增图层「**Mc 方块地图**」，默认开启（当该世界/维度 `tileCount > 0`）
- 实现：Leaflet 自定义 `GridLayer`，按 `(worldId, dimension, lod=-zoom, tx, tz)` 请求第 2 节 URL；`zoom>0` 用 LOD 0
- 瓦片缺失（404 / `missing`）时该处保持透明，由下方既有层层（山体阴影/等高线/矢量）补位，**不阻塞交互**
- 现有道路 / 城区 / Marker / 等高线 / 集市地点图层继续叠加，顺序：方块地图（底）→ 地形 → 等高线 → 矢量
- 坐标严格对齐：`CRS.Simple` + `lat=-z,lng=x`；提供「坐标跳转」「定位到数据」与瓦片范围一致
- 瓦片 `Cache-Control: public, max-age=31536000, immutable`，URL 带 hash 查询参数用于缓存失效（可选 `?v=<hash前8位>`）

---

## 8. 验收标准

1. 客户端：真实世界跑图后，LOD 0..2 瓦片在客户端渲染完成并上传成功（CI 用 GameTest 世界 + mock 服务端验证 ≥8 张瓦片内容非空、尺寸正确）
2. 服务端：幂等上传、越权/归档拒绝、覆盖度与索引接口、静态分发 200 + 长缓存
3. 网页：`/gis` 打开世界后看到彩色方块底图，矢量图层叠加正常；无瓦片的世界自动隐藏该图层
4. 性能：瓦片请求平均 < 100ms（本地静态/ CDN），2G2H 服务端无实时渲染压力，磁盘增长可控（单世界 LOD0 每 1000 方块² 约 4 张瓦片）
