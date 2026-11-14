# 玄剑 GIS 方块彩色地图（浏览器端实时渲染）设计

> 本文替代已废弃的 `docs/gis-tiles.md`（瓦片方案作废）。
> 结论：**地图渲染全部在浏览器完成**，服务端只做「区块地表数据查询」，不生成任何 PNG/WebP。

---

## 1. 数据来源与限制

现有区块上传载荷（`POST /api/gis/client/chunks`）只包含：

- `heightMatrix`：每列高度
- `biomeMatrix`：每列生物群系
- `blockHist`：**整个区块**的方块统计（不是逐列方块）

因此 v1 数据无法画出「草/水/石/建筑」的真实材质。方案：

- **v2 载荷新增可选 `surfaceBlockMatrix`**（`flags` bit3）：每列地表方块 ID（u16，`CRC32(资源名) & 0xFFFF`）
- 旧数据缺该字段 → 浏览器用「高度 + 生物群系」兜底着色（能看地形起伏与群系，但看不出建筑）
- 不新增数据库/服务，复用 `gis_elevation_chunks`（payload JSON 增加可选 `surface` 字段）

---

## 2. 服务端查询接口（只出数据，不出图）

### 2.1 调色板

```
GET /api/gis/map/palette
→ {
    ok: true,
    version: 1,
    blocks: { "<hash16>": "#7CBD4C", ... },       // 常用地表方块颜色
    biomes: { "<biomeHash>": "#7CBD4C", ... },    // 兜底：群系色
    heightShade: { minY: -64, maxY: 320 },        // 兜底：高度明暗
    water: { "<hash16>": true, ... },             // 水面（低明暗对比）
    materials: { "stone": "#8A8A8A", "wood": "#B08A4A", "unknown": "#7A7A7A" }
  }
```

配色表由服务端维护（`lib/gis/map-palette.js`），客户端只消费颜色，不硬编码。

### 2.2 视野区块查询（浏览器按需）

```
GET /api/gis/map/chunks
  ?worldId=3&dimension=overworld
  &bbox=minX,minZ,maxX,maxZ        // 必须，面积上限 4,000,000 blocks²
  &lod=3                            // blocksPerPixel = 2^lod，lod 0..6
```

响应（二进制字段 base64 小端）：

```json
{ "ok": true, "worldId": 3, "dimension": "overworld", "lod": 3, "step": 8,
  "bbox": {...},
  "chunks": [
    { "cx": 145, "cz": 7688, "size": 16,
      "mode": "surface",
      "blocks": "<base64 u16[256]>"        // 每采样点地表方块 hash16（0xFFFF=无数据）
    },
    { "cx": 146, "cz": 7688, "size": 16,
      "mode": "fallback",
      "heights": "<base64 i16[256]>",      // 旧数据：只有高度
      "biomes":  "<base64 u16[256]>"       // 可能缺省
    }
  ],
  "truncated": false,
  "chunksTotal": 24
}
```

规则：

- `step = 2^lod`；每区块按 step 抽样（取该 step×step 区域出现最多的地表方块 / 均值高度），响应体积与 lod 反相关
- 单次请求区块数上限 512，超出 `truncated:true`（前端缩小 bbox 再请求）
- 未采集区块不返回（前端透明，不伪造）
- 公开读（与其它 GIS 读接口一致），不需要登录

### 2.3 覆盖度/索引（判断底部图层是否可用）

```
GET /api/gis/map/index?worldId=3
→ { ok:true, worldId, dimensions:{ overworld:{ chunkCount:51, surfaceChunks:0, fallbackChunks:51,
      bbox:{...}, updatedAt }, ... } }
```

---

## 3. 浏览器渲染实现

### 3.1 图层

新增 Leaflet 图层 `GisBlockLayer`（`L.GridLayer` 子类）：

- 每个 256×256 的 Leaflet tile 对应 MC 方块范围 `256 × 2^(-zoom)`（`CRS.Simple`，`lat=-z, lng=x`）
- tile `zoom` → `lod = clamp(-zoom, 0, 6)`；`zoom > 0` 复用 `lod=0` 并按像素放大
- 创建 tile 时按 tile 的 MC bbox 请求 `/api/gis/map/chunks`，把返回的 chunk 数据画进 `<canvas>`（`putImageData` 或 `fillRect` 逐像素）
- 颜色：`palette.blocks[hash16]`；水面用 `water` 标记降对比；未知方块用 `materials.unknown`
- 兜底：`mode=fallback` 的区块用 `palette.biomes[biome]` 或按高度映射色带 + 明暗
- **浏览器缓存**：`Map<tileKey, canvas>`（LRU ≤ 256 张）+ `Map<chunkKey, data>`（LRU ≤ 4096），平移回来不重复请求
- 缺失数据 → 透明；由现有「山体阴影 / 等高线 / 矢量」图层补位，图层顺序：方块地图（底）→ 地形 → 等高线 → 城区/道路/标记/集市地点

### 3.2 交互

- 图层开关：「Mc 方块地图」（默认开启，若 `map/index` 显示该维度 `chunkCount=0` 则自动隐藏）
- 缩放/平移由 Leaflet 处理，仅按当前视口请求数据，**不会一次性加载整个世界**
- 现有「定位到数据」「跳转坐标」「坐标网格」继续使用，坐标严格对齐 MC X/Z

### 3.3 性能预算

- 单次请求 ≤ 512 区块 × 256 × 2 字节 ≈ 262 KB（lod 大时更小）
- 单 tile 绘制 ≤ 5ms（Canvas 逐像素 256×256）
- 前端 chunk 缓存命中后 0 请求；服务端仅做「读 JSON + 抽样」，无图像编码

---

## 4. 客户端（xuanjian-map-mod）改动

1. 采集时额外记录每列**地表方块**（顶层非空气方块；水面记录水方块本身）
2. 方块 hash：`CRC32("minecraft:grass_block") & 0xFFFF`，与 `httpRequest` 的 palette 使用同一算法
3. 上传载荷 `flags |= 8`，追加 `surfaceBlockMatrix`（`u16[sampleSize²]`）
4. 配置项：`capture.surfaceBlocks`（默认开）
5. 旧区块重传即 upsert 覆盖为 v2 数据（客户端在本地缓存里标记需要补传的区块）

> 客户端不改世界/权限/队列逻辑；只增加一个可选字段与开关。

---

## 5. 验收

1. 服务端：palette/chunks/index 接口单元测试；socket 抽样正确；旧数据 fallback；bbox 上限与 truncated
2. 浏览器：真实数据下 `/gis` 打开即见彩色方块底图（截图验收），缩放/平移只请求视口数据（Network 面板证据），矢量图层叠加正常
3. 性能：tile 绘制 < 5ms、接口 < 100ms（本地 51 区块量级）
4. 兼容：旧客户端/chunk 不报错，显示 fallback 着色

---

## 6. 实现说明（2026-11-15 落地于 xuanjian.top）

- **抽样字段**：`/api/gis/map/chunks` 每个 chunk 额外返回 `samplesPerSide`（每边采样点数 = `max(1, 16 >> lod)`：lod 0→16、1→8、2→4、3→2、4/5/6→1），`blocks` / `heights` / `biomes` 的长度 = `samplesPerSide²`；响应体积随 lod 反相关。这是对本文件 §2.2 中 `u16[256]` 示例的澄清（256 仅适用于 lod=0）。
- **渲染**：`frontend/src/components/gis/GisBlockLayer.js`（`L.GridLayer` + Canvas `putImageData`），tile 按 `tile ∩ 数据 bbox` 请求；`lod = clamp(-zoom, 0, 6)`，`zoom > 0` 时复用 lod=0 数据并按 `2^zoom` 像素放大。
- **缓存**：模块级共享 chunk 数据 LRU（4096，key = world:dimension:lod:cx:cz，跨图层实例/开关复用）+ 每图层 tile canvas LRU（256）；平移回来 0 请求。
- **兜底与性能**：surface 缺失 → 高度色带 + 群系色 + 邻域高差明暗；无数据 → 透明（不伪造）；单 tile 绘制实测 0.1–6 ms。
- **上限处理**：单次请求 bbox 面积 > 4,000,000 或区块数 > 512 时，前端把请求收缩到 tile 中心区域（其余透明、放大自动补全），服务端同时返回 `truncated:true`。
- **可见性**：`/api/gis/map/index` 该维度 `chunkCount=0` 时前端自动隐藏「Mc 方块地图」开关；有数据默认开启。
