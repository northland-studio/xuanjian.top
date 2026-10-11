# 紫雪坊市 · 公会集市（贡献点集市平台）

> 开发范围：**仅官网及其后端、数据库、管理后台与现有官网服务的集成**。
> 不含 Mod、MC 插件，也不做任何「官网能校验游戏内物品交付」的承诺——官网只负责
> 下单、资金托管、核销凭证与账务，游戏内交货由玩家自行完成并在官网确认收货。

- 后端：`lib/market*.js` + `routes/market.js`（挂在 `/api/market`），短链在 `/q/:code`
- 数据：`scripts/migrate-marketplace.js`（18 张 `market_*` 表 + 两处既有白名单扩展）
- 前端：`frontend/src/pages/Market*.jsx`、`frontend/src/components/MarketAdminPanel.jsx`、
  `frontend/src/components/MarketIcons.jsx`（内联 SVG 图标）、`frontend/src/market/helpers.js`、
  `frontend/src/styles/market.css`
- 联调：`scripts/test-market-e2e.js`（后端 E2E）、`scripts/test-market-qr.js`（二维码解码）、
  `scripts/test-market-isolation.js`（系统账号隔离）

## 0. 入口与页面

| 位置 | 说明 |
| --- | --- |
| 导航栏「经济 → 集市」 | 唯一入口，**不在导航下再分级**（集市内部页面靠页面里的快捷入口与页签切换） |
| `/market` | 集市首页（店铺 / 商品两个页签、分类与排序、搜索、快捷入口） |
| `/market/store/:id`、`/market/product/:id` | 店铺详情、商品详情与下单 |
| `/market/orders` | 我的订单（核销码 / 确认收货 / 退款 / 争议 / 评价） |
| `/market/merchant` | 商家后台（开店 / 商品 / 订单 / 核销台 / 退款 / 账务 / 评价管理） |
| `/market/map` | 店铺地图（可按服务器与维度筛选、导出地图画） |
| `/admin#market` | **集市管理不单独设页**，统一并入管理后台的「集市管理」页签（经济分组） |
| 头像菜单 | 只保留「管理后台」一个入口（支付管理与集市管理都在该后台的页签里） |

页面上所有图标均为内联 SVG（`components/MarketIcons.jsx`，写法对齐 `WikiIcons.jsx`）：
不使用 emoji 或 `★☆✓✕⚠` 等字形。分类图标按**分类 slug** 由前端映射，数据库 `icon` 字段留空
（原生 `<option>` 里也放不了 SVG），迁移脚本会幂等清掉历史种子里写入的 emoji 图标。

面向用户的使用说明写在 Wiki 的「网站教程」分类（`/wiki/category/wang-zhan-jiao-cheng`，共 20 篇，
其中置顶三篇：网站功能总览 / 集市交易流程：从下单到结算 / 集市店铺说明：开店与经营），
由 `scripts/wiki-site-guide.js` 幂等写入（走 `lib/wiki.js`，保版本、内链与全文索引）。

---

## 1. 账务模型（用户确认过的口径）

### 1.1 公会没有余额账号

公会收入**不落在任何用户余额上**。用户付的费用与税金一经收取即退出流通，只在
`market_finance_ledger`（收入分户账）留凭证：

| direction | 含义 | 资金动作 |
| --- | --- | --- |
| `in` | 公会收入 | 从付款方账户扣掉，不再计入任何人余额 |
| `out` | 收入冲回 | 钱重新加回用户余额（例如开店被拒退费） |

托管账号 `market_escrow`（`users.username='market_escrow'`，`level=-1`，不出现在排行榜/成员列表）
是**唯一的资金中间态**：下单时买家付款进它，结算/退款时从它划出。`level=-1` 保证现有成员列表、
排行榜等按 `level >= 0` 过滤的功能天然不会带出系统账号。

> 系统账号隔离（已对既有功能做加固，见 `scripts/test-market-isolation.js`）：
> 统一口径 `COALESCE(level, 0) >= 0`（0/1/2 = 会员与管理员，-1 = 系统账号）。
> 覆盖：贡献点转账**双向**拦截（目标与来源都不能是系统账号——否则托管余额会被转乱）、
> 缴费单成员搜索、贡献点排行榜、经济概览与报表导出、捐赠录入搜索、聊天 @ 与最近用户、
> 纪律处分查询、玩家排名计数、日报/决策全员通知、成员档案查询/导出/查伪。

> 历史沿革：早期设计曾有一个公会财政账号 `market_treasury`，已按用户要求删除；
> 迁移脚本会幂等地清理它（余额非 0 则拒绝删除，删除前写审计痕迹）。

### 1.2 三件套，没有平台服务费

明确**没有、也不允许**出现「平台服务费 / 按成交额抽成」的科目或逻辑：

1. **开店费** `open_fee`（可关、可设首店免）
2. **续期费** `renew_fee`（按周期，余额不足进宽限期，逾期从当期起算避免重复扣费）
3. **交易税** `tax`（税率以**整数基点**存储，按订单快照落库）

资金路径：

```text
下单      买家 -buyerPay            → market_escrow +buyerPay
结算      escrow -merchantIncome    → 商家 +merchantIncome
          escrow -tax               → 退出流通，写 market_finance_ledger(tax, in)
          （商家所得 + 税 = 买家实付，两种承担方式都成立）
退款      escrow -refund            → 买家 +refund
          （未结算订单从未记过税，因此不写税务冲回，避免把公会收入记成负数）
开店费    店主 -fee                 → 退出流通，写 market_finance_ledger(open_fee, in)
被拒退费  店主 +fee                 → 写 market_finance_ledger(refund_fee, out)
争议      钱留在 escrow，禁止自动结算，等管理员裁决
```

### 1.3 金额与税费

- 全部金额两位小数（`market.money()`），与 `users.contribution` 的两位小数触发器一致。
- 计税：`tax = 四舍五入(taxBase × taxRateBp / 10000)`，`taxRounding` 可切换 `round|floor|ceil`。
- 承担方 `taxMode`：
  - `merchant`（默认）：买家只付成交额，税从商家应得里扣 → `merchantIncome = taxBase - tax`
  - `buyer`：商家照拿成交额，买家多付税 → `buyerPay = taxBase + tax`
- 订单落库时快照 `tax_rate_bp / tax_mode / tax_amount / buyer_pay / merchant_income`，
  事后改费率不影响历史订单。

### 1.4 幂等与并发

- 下单：`market_orders.idem_key`（UNIQUE）或 `Idempotency-Key` 头；重复提交返回原单且不再扣款。
- 退款 / 结算 / 收费：`market_refunds.idem_key`、`market_finance_ledger.idem_key`（UNIQUE）。
- 库存：`UPDATE ... SET stock = stock - ? WHERE id = ? AND status='on' AND stock >= ?`，
  条件更新防超卖。
- 状态推进即闸门：结算/退款先把状态推进（带 `WHERE status IN (...)`），抢不到的调用整体回滚，绝不重复动钱。
- 资金事务进程内串行化（`serialized()`）：`sqlite3` 是单连接，两个请求同时 `BEGIN` 会互相冲突，
  排队执行比报 500 更稳。

---

## 2. 数据表

迁移脚本 `scripts/migrate-marketplace.js`（幂等，可反复执行）：

1. 备份数据库文件到 `data/backups/<db>.pre-marketplace-<时间戳>.bak`
2. 扩展 `contribution_logs.type` 白名单：`market_escrow_in / market_escrow_out / market_sale /
   market_tax / market_fee / market_refund / market_adjust`（重建表 + 逐行数校验 + 真正写入探针）
3. 扩展 `notifications.type` 白名单：`market_store / market_order / market_fee / market_review / market_dispute`
4. 建 18 张业务表：

| 表 | 用途 |
| --- | --- |
| `market_stores` | 店铺（店主、状态、有效期、开店费、评分/成交统计、公告） |
| `market_store_locations` | 店铺位置（服务器/维度/XYZ/是否公开） |
| `market_categories` | 店铺与商品分类（内置 14 条种子） |
| `market_products` | 商品（价格、库存、限购、状态） |
| `market_product_images` | 商品图（多图，只存 URL） |
| `market_orders` | 订单（金额、税快照、状态机、幂等键） |
| `market_order_items` | 订单行（标题/价格/规格快照，不依赖商品行） |
| `market_verify_codes` | 核销码（**只存 sha256 哈希 + 末四位**） |
| `market_fee_ledger` | 开店费/续期费扣费台账（含失败原因、周期、幂等键） |
| `market_finance_ledger` | 公会收入分户账（`in`/`out`，三类收入 + 冲回 + 调账） |
| `market_reviews` | 评价（一单一评，可回复、可隐藏） |
| `market_favorites` | 收藏（店铺/商品） |
| `market_disputes` | 争议（开争议、裁决结果） |
| `market_refunds` | 退款申请与处理结果 |
| `market_short_links` | 短链（二维码指向 `/q/<code>`） |
| `market_archives` | 档案（`kind='store'` 商铺档案 / `kind='ledger'` 账本档案） |
| `market_notify_events` | 通知 Outbox（`event_key` 唯一，含投递状态与失败原因） |
| `market_audit_logs` | 审计（费率、审核、结算、退款、调账、封禁等敏感操作） |

5. 写默认配置 `settings.market_config`
6. 建托管账号并同步头像（与公会官方账号 `xuanjian_guild` / id=1 同款；
   已核查 `users.avatar` **没有唯一约束**，因此直接复用同一 URL，无需另传七牛）
7. 清理废弃的 `market_treasury`

---

## 3. 状态机

订单：`pending_payment 待付款 → paid 已付款·待核销 → delivered 已核销·待履约 →
awaiting_confirm 待确认收货 → settled 已完成`，另有 `cancelled / refunding / refunded / disputed / expired`。

店铺：`pending 待审核 / active 营业中 / paused 暂停营业 / grace 续费宽限期 /
suspended 欠费暂停 / closed 已关闭 / rejected 审核未通过`。

只有 `active` 与 `grace` 的店铺可以接单（宽限期仍允许经营，欠费暂停/关闭不行）。
欠费暂停只下架「因欠费自动下架」的商品，续费后自动恢复，不误伤店主手动下架的商品。

---

## 4. 核销码安全

- 下单时生成 `BW-XXXX-XXXXXX`（去掉 I/O/S/Z/0/1/2/5/8 等易混字符），
  **明文只在创建响应里出现一次**（重复提交不会再返回明文）。
- 库里只存 `sha256(大写去空格)` 与末四位，订单页/商家页只显示末四位。
- 邮件、站内通知、公开页面、日志都**不放明文码**（E2E 里有一条断言扫描全库文件确认搜不到明文）。
- 核销只能由「订单所属店铺的店主或管理员」执行，幂等（重复核销不重复处理），
  支持过期时间与失败计数（超 20 次拒绝），买家可重新生成（旧码作废）。

### 4.1 核销码二维码（为什么在浏览器本地生成）

明文码只在「下单成功」与「重新生成」时各返回一次，**服务端根本没有明文**（只有 sha256 与末四位），
所以二维码只能在买家浏览器里生成（`frontend/src/components/MarketCodeQr.jsx` + `market/verify-code.js`），
明文不回传服务端。二维码内容不是裸码，而是**商家后台核销台的深链**：

```text
<SITE>/market/merchant?store_id=<店铺>&code=<核销码>
```

商家用手机扫码 → 打开核销台 → 自动选中该店、切到核销台页签、**预填**核销码并聚焦输入框
（只预填，必须商家自己再点「核销」，不会自动扣款）。`/api/market/qr/<code>.png` 只用于
店铺/商品的**短链**二维码，不要拿它给核销码出图（那个短链表里没有核销码，会 404）。

### 4.2 重新生成 = 旧码立即失效（踩过一次坑）

买家点一次「重新生成」，上一枚码立刻作废（库里 `code_hash` 被覆盖）。生产上出现过
「买家反复重新生成 16 次、把最早那枚码给商家 → 商家核销报『核销码无效』」的事故，
因此界面四处都加了提示：下单成功弹窗、订单页的核销码弹窗、重新生成的二次确认、
以及商家核销台失败提示（后端 404 文案直接告诉商家「让买家重新生成后再试」）。
订单页在「只有末四位、拿不到完整码」时也会引导买家重新生成并强调**以最新一次为准**。

---

## 5. 通知（复用现有三路，不另建体系）

`market_notify_events` 是 Outbox：业务事务提交后写事件（`event_key` 唯一 = 幂等），
再由定时任务或 `/admin/notify/dispatch` 投递：

| 渠道 | 复用的现有服务 |
| --- | --- |
| 站内通知 | `routes/notifications.js` 的 `createNotification()`（落 `notifications` 表，复用既有 `type` 白名单） |
| 实时推送 | `lib/realtime.js` 的 `sendToUsers()`（WebSocket `/ws`） |
| 邮件 | `config/mail.js` 的 `sendGenericNotification()`（`smtp.exmail.qq.com`） |
| 系统弹窗 | `announcements` + `AnnouncementPopup` 仅用于全员级公告，集市默认不占用 |

投递失败会记 `attempts` 与 `last_error` 并重试（最多 5 次）；无邮箱的用户邮件渠道记为
`mail:no-address` 跳过，不算失败。通知payload 里绝不带明文核销码。

---

## 6. 档案

按用户确定的口径：**只把商铺信息与账本纳入档案**（不做通用公文档案系统）。

- `kind='store'`：开店申请、资料变更、审核结果，档案号 `PS-YYYYMMDD-XXXX`
- `kind='ledger'`：订单结算（成交额/税/商家所得/承担方/税率），档案号 `PL-YYYYMMDD-XXXX`
- 幂等：同 `kind+ref_type+ref_id` 只保留一条并更新内容。
- 管理员可在 `/market/admin` → 档案里按类型与关键词检索。

---

## 7. 接口一览

公开：
`GET /api/market/config`、`/stores`、`/stores/:id`、`/products`、`/products/:id`、`/map`、
`/qr/:code.png`、`/poster/:code.png`、`/map/art.png`，以及短链 `GET /q/:code`（302 到页面）。

买家（需登录）：
`POST /orders`（幂等）、`GET /orders`、`GET /orders/:id`、`POST /orders/:id/regen-code`、
`POST /orders/:id/confirm`、`/cancel`、`/refund`、`/dispute`、`POST /reviews`、
`GET|POST /favorites`、`DELETE /favorites/:type/:id`。

商家：
`POST /merchant/stores`（开店，含开店费）、`GET /merchant/stores`、`PUT /merchant/stores/:id`、
`POST /merchant/stores/:id/renew`、`POST /merchant/stores/:id/status`、
`POST /merchant/stores/:id/locations`、`PUT|DELETE /merchant/locations/:id`、
`GET|POST /merchant/products`、`PUT|DELETE /merchant/products/:id`、`GET /merchant/orders`、
`POST /merchant/verify`（核销）、`POST /merchant/orders/:id/deliver`、
`POST /merchant/refunds/:id/approve|reject`、`GET /merchant/finance`。

管理员（`users.level >= 1`，后端实时校验）：
`GET /admin/stores`、`POST /admin/stores/:id/review`（`action=approve|reject`）、
`POST /admin/stores/:id/status`、`GET|PUT /admin/config`、`POST /admin/config/simulate`（试算）、
`GET /admin/orders`、`POST /admin/orders/:id/refund`、`GET /admin/disputes`、
`POST /admin/disputes/:id/resolve`、`GET /admin/finance`、`POST /admin/finance/adjust`（必须指定用户 + 理由）、
`GET /admin/archives`、`GET /admin/audit`、`GET /admin/notify/events`、`POST /admin/notify/dispatch`、
`POST /admin/jobs/run`、`GET /admin/reconcile`、`POST|DELETE /admin/categories`。

---

## 8. 定时任务

`lib/market-jobs.js` 由 `server.js` 启动（`MARKET_JOBS_INTERVAL_MS` 默认 600000，即 10 分钟；
设为 `0` 关闭）。`market_*` 表不存在时自动跳过，不会刷错误日志。

- `renewDue`：到期扣续期费（幂等键 = 店铺 + 到期时间；逾期从当期起算，避免重复扣费）；
  余额不足 → 进宽限期 + 记失败原因
- `graceExpire`：宽限期结束 → 欠费暂停 + 自动下架商品（标注「欠费自动下架」）
- `remindDue`：到期前提醒（站内 + 邮件）
- `expireOrders`：超时未付款订单置为已过期
- `autoConfirm`：商家已交付且超过 `autoConfirmDays` → 自动结算
- `dispatchPending`：投递通知 Outbox

管理员可随时 `POST /api/market/admin/jobs/run` 手动跑一轮（幂等）。

---

## 9. 出图（二维码 / 海报 / 地图画）

`lib/market-render.js` 复用 `lib/pay-render.js` 的 sharp + Noto CJK 管线（不引 Chromium）：

- `GET /api/market/qr/<code>.png`：短链二维码（512×512，进程内缓存 300 条）；
  短链不存在返回 404，避免变成任意二维码生成器
- `GET /api/market/poster/<code>.png`：分享海报（720×1000，店铺或商品公开信息 + 二维码 + 坐标/价格）
- `GET /api/market/map/art.png`：地图画（640×640，按百分比刻度画落点，可供游戏内地图画/宣传）

海报只含公开信息，**不含核销码**。

---

## 10. 配置项（`settings.market_config`）

| key | 默认 | 说明 |
| --- | --- | --- |
| `openFeeEnabled` / `openFee` / `openFeeFirstFree` | true / 5 / true | 开店费与首店免 |
| `renewFeeEnabled` / `renewFee` | true / 2 | 续期费 |
| `cyclePreset` / `cycleDays` | monthly / 30 | 计费周期 |
| `graceDays` / `remindBeforeDays` / `autoPauseAfterGrace` | 7 / 3 / true | 宽限期与提醒 |
| `taxEnabled` / `taxRateBp` / `taxMode` / `taxRounding` | true / 500 / merchant / round | 交易税（5%，商家承担） |
| `maxOpenStoresPerUser` / `maxProductsPerStore` / `perOrderLimitDefault` | 1 / 50 / 10 | 限额 |
| `verifyCodeTtlHours` / `autoConfirmDays` | 72 / 7 | 核销码有效期、自动确认天数 |
| `mapRange` / `mapBackgrounds` | ±2000, flipZ | 地图投影范围与底图（按 `服务器\|维度` 配） |

费率的默认值是按线上真实经济规模定的（66 个账号、总余额约 2024 点、中位数 0、
P90 约 118 点、在售商品 0.08–7777 点），管理员可在管理后台随时调整。

---

## 11. 部署与运维

```bash
# 1) 迁移（幂等；自动备份到 data/backups/）
DB_FILE=data/guild.db node scripts/migrate-marketplace.js            # 生产库就是默认值
#    先看会做什么：node scripts/migrate-marketplace.js --dry-run

# 2) 重启后端
pm2 restart xuanjian-guild

# 3) 前端构建与发布（沿用既有脚本）
bash scripts/build-frontend.sh
```

- 环境变量：`MARKET_JOBS_INTERVAL_MS`（定时任务间隔）、`SITE_URL`（出图里的站点地址，
  二维码内容用 `SITE_URL + /q/<code>`）。
- 回滚：迁移前已自动备份 `data/backups/*.pre-marketplace-*.bak`，替换回该文件即可；
  代码回滚用 `git revert`。
- 运维入口：管理后台「对账自检」会同时校验
  ①托管余额 = 未结算订单合计 ②交易税 = 已结算订单税额 ③开店费 = 店铺已缴开店费 − 退费
  ④续期费 = 扣费台账，并检查分户账是否存在非法金额/科目/方向。

---

## 12. 测试

```bash
# 后端端到端（用测试库，勿用生产库）
DB_FILE=data/wiki-mobile-test.db PORT=3998 node server.js         # 终端 A
DB_FILE=data/wiki-mobile-test.db node scripts/test-market-e2e.js 3998   # 终端 B（可加 --reset 清脏数据）
DB_FILE=data/wiki-mobile-test.db node scripts/test-market-qr.js 3998
```

覆盖：开店收费/审核/拒绝退费、商品与富文本净化、下单（幂等 + 并发幂等 + 越权）、
托管账、核销（错误码/越权/重复）、交付、结算与交易税、评价/收藏、退款、争议裁决、
续费与欠费宽限、三路通知投递、收入分户账与对账、手工调账、明文核销码全库文件扫描、
二维码真实解码（jsqr + pngjs）。

系统账号隔离自检（与既有功能互不影响）：

```bash
DB_FILE=data/wiki-mobile-test.db node scripts/test-market-isolation.js 3998
```

覆盖：转账双向拦截、四个榜单/报表、五个成员搜索入口、集市内部仍可见托管账号（对账需要）。

前端：

```bash
cd frontend
npm run build            # 客户端产物（另见 scripts/build-frontend.sh 会一并构建 SSR 产物）
npm run lint             # oxlint：仓库基线 86 warnings / 0 errors
npx oxlint src/pages/Market*.jsx src/components/MarketAdminPanel.jsx src/components/MarketIcons.jsx
                         # 集市相关文件单独跑：0 warnings / 0 errors
```

部署脚本：`scripts/deploy-market-20261011.sh`（后端 + 迁移）、
`scripts/deploy-market-isolation-20261011.sh`（系统账号隔离加固）、
`scripts/deploy-market-frontend-20261011.sh` 与 `…-frontend2-20261011.sh`（前端产物 + SSG 重建）。

---

## 13. 已知限制与后续

- **不做**游戏内交货校验：官网只能记录「商家核销 + 买家确认」，这是业务事实的边界。
- 平台服务费/抽成**永不实现**（用户明确要求）。
- 商品位置是店铺级位置，不做「按商品分别设坐标」。
- 地图底图需要管理员自行上传图片并配置世界坐标范围（`mapBackgrounds`），当前只支持一层底图；
  地图画预览反映的是**已保存**的范围，刚改完范围需先保存再看。
- 官网其余页面历史上用过 emoji（如库存页 📦、排行榜奖牌、皮肤浮窗的 × 收起按钮），
  本次只保证集市相关页面全部 SVG；那些属于既有界面，未一并改动。
- 站内聊天/机器人通知尚未接入集市事件（现有三路通知已够用，机器人推送可按需再加）。
