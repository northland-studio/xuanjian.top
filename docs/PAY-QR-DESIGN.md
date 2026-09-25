# 贡献点扫码支付（玄剑版「微信支付」）设计说明

> 状态：已与需求方逐项确认（7/7），进入开发。
> 本文是实现的契约来源：表结构、接口、状态机、风控参数以本文为准；改动需同步本文。

## 1. 目标与范围

把官网现有的「贡献点」做成可扫码收付的体系，形态对齐微信支付的三件套：

| 形态 | 谁扫谁 | 用途 |
|---|---|---|
| **收款码（主扫）** | 付款方扫收款方展示的码 | 面对面收款、群里收分 |
| **付款码（反扫）** | 收款方扫付款方展示的动态码 | 摊位/活动快速结算 |
| **缴费单码** | 多人扫同一个码，各付各的 | 团建、活动报名、AA |

第一期入口：**官网 H5** + **QQ 机器人**（游戏内 mod 与启动器不做）。

## 2. 已确认决策（7 项）

| # | 决策 | 取值 |
|---|---|---|
| 1 | 收款方类型 | 个人 / 活动摊位 / **公会官方（系统金库账户「玄剑财政」）** |
| 2 | 码的种类 | 三种全做（含站内相机反扫） |
| 3 | 付款确认 | **必须由付款方在已登录会话中二次确认**；不做免密，扫码≠授权 |
| 4 | 风控 | 单笔 ≤ **500**、日累计 ≤ **2000**、> **200** 需管理员审批；全量流水 + 对账页。**无手续费、不做反跑分、不做退款/撤回** |
| 5 | 有效期 | 付款 intent **90 秒**；付款码 **60 秒**刷新；个人收款码**不做长期固定码** |
| 6 | 入口 | 官网 H5 + QQ 机器人 |
| 7 | 金额口径 | 余额与金额沿用 `REAL` 存**两位小数**，靠 `ROUND(...,2)` + 触发器 `trg_users_contribution_2dp` 保证精度（**未采用整数分改造**，见 §3 实现说明） |

补充：生成收款码 = 所有已登录用户；生成缴费单 = 仅管理员/已认证成员。

## 3. 数据模型（SQLite）

```sql
-- 收款主体：个人 / 活动摊位 / 系统金库
CREATE TABLE pay_payees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,              -- user | event | system
  user_id       INTEGER,                    -- type=user 时的收款账号
  system_key    TEXT,                       -- type=system 时的键，如 'guild_treasury'
  display_name  TEXT NOT NULL,              -- 展示名（活动名 / 「玄剑财政」）
  owner_user_id INTEGER,                    -- type=event 时的负责人
  status        TEXT NOT NULL DEFAULT 'active',  -- active | disabled
  created_at    TEXT NOT NULL
);

-- 付款意图（三种码共用；token 即二维码内容）
CREATE TABLE pay_intents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT NOT NULL UNIQUE,       -- ≥128bit 随机，二维码内容 .../pay/<token>
  kind          TEXT NOT NULL,              -- receive | charge | payer_code
  payee_id      INTEGER NOT NULL,
  payer_user_id INTEGER,                    -- 指定付款人；NULL = 任何人可付（收款码/缴费单）
  amount        REAL,                       -- 缴费单/指定金额时为定值；收款码可 NULL（由付款方填）
  note          TEXT,                       -- 用途/备注
  expires_at    TEXT NOT NULL,              -- 默认 now + 90s；payer_code 为 60s
  status        TEXT NOT NULL DEFAULT 'created', -- created|scanned|awaiting_approval|paid|expired|cancelled
  scanned_by    INTEGER,                    -- 谁扫开的（付款方）
  created_by    INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  paid_at       TEXT,
  paid_tx_id    INTEGER,                    -- 关联流水
  meta          TEXT                        -- JSON：缴费单标题/截止时间等
);

-- 资金流水（对账唯一依据；不可变）
CREATE TABLE pay_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id     INTEGER,
  from_user_id  INTEGER,                    -- NULL = 系统（金库支出）
  to_payee_id   INTEGER NOT NULL,
  amount        REAL NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL,              -- success | pending_approval | rejected | failed
  approver_id   INTEGER,                    -- 大额审批人
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL,
  settled_at    TEXT
);

-- 缴费单（一码多人）：已付/未付名单由 pay_transactions 按 intent 聚合
CREATE TABLE pay_charges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id     INTEGER NOT NULL,           -- 指向缴费单码
  user_id       INTEGER,                    -- 应付人（可空 = 公开报名式）
  player_name   TEXT,
  amount        REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid | waived
  paid_tx_id    INTEGER,
  updated_at    TEXT NOT NULL
);
```

**金额口径（实现说明）**：原计划把余额整数化（新增 `users.balance_cents` 并切换所有读写），实际落地时改用
**更小改动面**的方案：金额仍存 `REAL`，全链路按两位小数处理——
`scripts/migrate-contribution-2dp.js` 一次性 `ROUND(contribution, 2)`，并加触发器
`trg_users_contribution_2dp`（AFTER UPDATE OF contribution，`NEW.contribution <> ROUND(NEW.contribution,2)` 时回写），
现有 30 余处扣加 SQL 无需逐个改造；`routes/pay.js` 侧所有金额读写再显式 `ROUND(...,2)`。
因此本文档下方表结构里的 `amount_cents INTEGER` 实际实现为 `amount REAL`（两位小数），
API 一律以「元」为单位收发，不再出现「分」。

## 4. 接口

### 4.1 付款方（H5，需登录会话）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/pay/:token` | 落地页：只读展示「付给谁 / 多少 / 用途 / 剩余秒数」；未登录先跳登录 |
| POST | `/api/pay/intents/:token/confirm` | **二次确认并付款**（幂等：同一 intent 只能成功一次） |
| POST | `/api/pay/intents/:token/reject` | 付款方取消 |
| GET | `/api/pay/my` | 我的付款码（含 60 秒刷新） |
| GET | `/api/pay/records` | 我的流水 |

### 4.2 收款方 / 管理员

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/pay/receive-code` | 登录 | 生成收款码（动态，90 秒） |
| POST | `/api/pay/charge` | 管理员/认证成员 | 创建缴费单（标题/金额/截止/名单） |
| GET | `/api/pay/charge/:id` | 登录 | 缴费单详情（已付/未付名单） |
| GET | `/api/pay/admin/records` | 管理员 | 全量流水 + 对账（可导出 CSV） |
| POST | `/api/pay/admin/approve/:id` | 管理员 | 大额审批通过/驳回 |

### 4.3 QQ 机器人

| 指令 | 说明 |
|---|---|
| `/转分 @某人 <金额> [备注]` | 生成收款码图片并回复；付款方扫码后在网页确认 |
| `/收款码 [金额] [备注]` | 生成自己的收款码 |
| `/付款码` | 生成 60 秒有效的付款码图片 |
| `/缴费单` | 管理员创建缴费单并出码 |

机器人侧只负责**出码与播报**，扣款一律回到网页确认（与决策 3 一致）。

## 5. 状态机

```
created ──扫开──▶ scanned ──付款方确认──▶ [amount>200 ? awaiting_approval : paid]
   │                  │                          │                │
   │                  │                          └─管理员通过─▶ paid
   └─90s 到期─▶ expired（需重新生成）      awaiting_approval ─管理员驳回─▶ rejected
```

- `paid` 之后**不可撤销**（决策 4：不做退款/撤回），如需纠错由管理员走既有的申报/转账流程并留存记录。
- 幂等：`confirm` 以 `intent_id + payer_user_id` 唯一约束；重复请求返回同一 `pay_transactions`。

## 6. 安全要点（开发时逐条落实）

1. `token` ≥128 位随机（`crypto.randomBytes(16)` 以上），**一次性**，服务端持久化。
2. **扫码 ≠ 授权**：落地页只读；扣款必须 `POST confirm` 且校验会话用户与 intent 的付款方一致。
3. 金额与收款人**写在服务端**（intent 关联），前端只读；缴费单金额不可被篡改。
4. 扣加必须在 **SQLite 事务**内完成，并再校验一次余额是否充足、上限是否超限。
5. 风控：单笔 500 / 日累计 2000（按付款方自然日聚合）/ >200 进审批队列。
6. 全量审计：`pay_transactions` 记录付款方、收款方、金额、用途、IP、UA、时间；管理员可见、可导出。
7. 相机降级：`getUserMedia` 不可用（微信内置浏览器）或权限被拒时，提供「上传二维码图片识别」与「手动输入码/链接」。

## 7. 开发顺序（每步可独立验证）

1. ~~余额整数化迁移~~ → **改用两位小数方案**（`scripts/migrate-contribution-2dp.js` + 触发器），已上线
2. ✅ **数据表迁移 + 收款码（个人/活动/金库）生成与主扫付款闭环**（2026-09-25 上线 HK；
   `scripts/migrate-pay.js` 建表并扩展 `contribution_logs.type` / `notifications.type` 白名单，
   `routes/pay.js` 提供 `receive-code` / `intents/:token` / `confirm` / `records` / `admin/settings`，
   联调 `scripts/test-pay-e2e.js` 31 项断言全通过，生产已用临时账号跑通并清理）
3. ✅ **付款码（反扫）+ 站内相机扫码 + 三级降级**（付款码 60 秒刷新 `GET /api/pay/payer-code/current`；
   收款方 `POST /api/pay/scan` 扫付款码并发起收款，付款方在 `/pay` 轮询 `GET /api/pay/payer-code/pending` 确认；
   扫到收款码/缴费单码时同一接口返回 `mode:'direct'` 直达付款页；前端相机 → 上传图片解码（jsQR）→ 手动粘码三级降级）
4. ✅ **缴费单码（一码多人）**（`POST /api/pay/charge` 开单（管理员或认证成员）、`GET /api/pay/charge/:token` 详情与名单、
   `POST /api/pay/charge/:token/pay` 各自缴纳自己的份额、`POST /api/pay/charge/:token/close` 关闭；
   名单支持指定用户 / 未绑定玩家姓名 / 开放缴纳（openAll）；收款方可为活动摊位或系统金库）
5. ✅ **风控与审批、管理员对账页**（`GET /api/pay/admin/approvals`、`POST /api/pay/admin/approve/:id`
   （action=approve/reject，通过时才真正扣款并同步缴费单名单）、`GET /api/pay/admin/records`（筛选 + CSV 导出）、
   `GET /api/pay/admin/summary`（今日/近 7 天/累计、待审批、金库余额、Top 收款方）、阈值 `GET|PUT /api/pay/admin/settings`）
6. ✅ **QQ 机器人指令**（`/收款码`、`/付款码`、`/缴费单`、`/转分`；机器人只出码与播报，扣款一律回官网确认；
   官网侧接口 `routes/qqbot-pay.js` 挂载 `/api/qqbot/pay`，鉴权沿用 `X-Bot-Token`、绑定沿用 `users.qq`，
   业务复用 `routes/pay.js` 导出的服务层，机器人源码为独立仓库 `northland-studio/xuanjian-group-bot`）
7. ✅ 可视化验收（支付中心 / 付款落地页 / 缴费单 / 对账页截图）→ 已部署 HK（官网）与 NapCat 主机（机器人）

## 7.2 时区与倒计时（重要实现约定）

库内时间统一为服务端本地时间（HK 为 UTC），而用户浏览器可能在任何时区：**前端不得把 `expiresAt` 字符串
按本地时区解析后与本地时钟比较**，否则 UTC+8 的浏览器会把刚生成的收款码判定为「已过期」。

约定：服务端在 intent / charge / charges 列表里返回 `remainSeconds`（`remainSecOf()` 计算），
前端 `PayIntent.jsx` / `PayCharge.jsx` / `PayRecords.jsx` 一律以它为准做倒计时（`serverRemain()` 兜底旧接口）。
该问题已在生产实测复现并修复（修复前扫码落地页恒显示「已过期」）。

部署踩坑：官网 `.env` 的 `QQBOT_TOKEN` 必须独占一行，注释与赋值同行会让 dotenv 读不到，
导致所有 `/api/qqbot/*`（含既有绑定/核销/任务码指令）恒 401。

## 7.1 接口总览（实现现状，全部挂载于 `/api/pay`）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/receive-code` | 登录 | 收款码（90 秒、一次性 token） |
| GET | `/payer-code/current` | 登录 | 付款码（60 秒刷新，返回 `pendingToken` 供确认） |
| GET | `/payer-code/pending` | 登录 | 我的付款码被扫后的待确认收款 |
| POST | `/scan` | 登录 | 扫任意码：付款码→发起收款；收款码/缴费单码→`direct` 直达付款 |
| GET | `/intents/:token` | 登录 | 只读展示付款信息（含我的份额、额度、`isSelf`） |
| POST | `/intents/:token/confirm` | 登录 | 本人确认支付（幂等、事务、风控、>200 转审批） |
| POST | `/intents/:token/reject` | 登录 | 本人取消（仅限已锁定到本人的码） |
| POST | `/charge` | 管理员/认证成员 | 创建缴费单（标题/金额/截止/名单/开放缴纳/收款主体） |
| GET | `/members?q=` | 管理员/认证成员 | 按 昵称/用户名/QQ 号 搜索成员（仅返回昵称、用户名、是否绑定 QQ，不返回 QQ 号本体），供「逐个加入名单」使用 |
| POST | `/charge/:token/targets` | 创建者/管理员 | 向已创建的缴费单逐个加入成员（按 userId / QQ / 用户名 / 玩家名称），自动跳过重复并给被加入者发待缴通知 |
| DELETE | `/charge/:token/targets/:id` | 创建者/管理员 | 把未缴费的成员移出名单（已缴/审批中不可移除） |
| GET | `/charge/:token` | 登录 | 缴费单详情与已付未付名单 |
| POST | `/charge/:token/pay` | 登录 | 缴纳我的份额（大额自动转审批） |
| POST | `/charge/:token/close` | 创建者/管理员 | 关闭缴费单 |
| GET | `/charges` | 登录 | 我创建或需缴纳的缴费单 |
| GET | `/records` | 登录 | 我的收付款记录 + 今日已付额度 |
| GET | `/admin/approvals` | 管理员 | 待审批大额支付 |
| POST | `/admin/approve/:id` | 管理员 | 审批通过（真正划转）/ 驳回（回退名单状态） |
| GET | `/admin/records` | 管理员 | 全量流水（筛选 + `format=csv` 导出，带 BOM 便于 Excel 打开） |
| GET | `/admin/summary` | 管理员 | 对账概览（含金库余额与最终对账口径） |
| GET/PUT | `/admin/settings` | 管理员 | 风控阈值（`pay_single_limit` / `pay_daily_limit` / `pay_approval_threshold`） |
| GET | `/qr.png?text=` | 公开只读 | 二维码图片（仅允许 `https://xuanjian.top/pay/<token>` 或纯 token，≤512 字符） |
| GET | `/render/charge/<token>.png` | 公开只读 | 缴费单海报（标题/金额/截止/双进度条/二维码，**不含名单姓名**），供 QQ 机器人直发图片 |
| GET | `/render/summary.png?exp=&sig=` | 签名短链 | 财务对账海报（HMAC 签名 10 分钟有效，篡改/过期 403）；机器人先用 `/api/qqbot/pay/render-url` 换链接 |
| POST/GET | `/api/qqbot/pay/*` | 机器人 token | 机器人代绑定 QQ 用户出码 / 查记录 / 开单 / 换签名图片链接 / 轮询待审批 / 群内审批 |

联调脚本：`scripts/test-pay-e2e.js`（阶段 2，31 项断言）、`scripts/test-pay-e2e2.js`（阶段 3-5，57 项断言），
两者都会在结束时回滚余额、恢复阈值、清理测试数据；生产联调见 `scripts/deploy-pay-verify.sh` / `deploy-pay-verify2.sh`（用临时账号）。

## 7.3 群内出图、审批与播报（阶段 6 增强）

- **出图**：`lib/pay-render.js` 用 SVG→PNG（sharp）渲染两张海报，中文依赖系统 CJK 字体（HK 已装 fonts-noto-cjk）。
  缴费单海报公开只读，故意**不含名单姓名**；对账海报含管理数据，必须签名链接 ——
  签名用 `JWT_SECRET` 做 HMAC-SHA256（`kind:exp`），10 分钟有效、常量时间比较，日志与前端都不出现密钥。
- **为什么要签名链接**：QQ 服取图时不带任何请求头，所以带 `X-Bot-Token` 的图片接口机器人发不出去，
  只能先用机器人接口换一个短时效签名 URL。
- **群内审批**：机器人轮询 `/api/qqbot/pay/pending-approvals`（每 60 秒，带 id 去重持久化避免重启重复播报），
  发现新的大额待审批就播报并给出 `#通过 <id>` / `#驳回 <id>`；审批动作调用
  `/api/qqbot/pay/approve/:id`，权限校验为「绑定账号 level≥1」，与网页管理端共用 `approveTransaction()`。
- **播报**：财务月报（每月 1 日 10:00）发对账海报图，周报（每周一 09:00）发文字活跃榜；
  时区按 Asia/Shanghai 换算（服务器为 UTC），全部由 env `PAY_BROADCAST` 控制开关（缺省 off），
  单次播报对官网请求 ≤3 次，失败静默退避。

## 8. 已知取舍

- 不做退款/撤回（决策 4）→ 纠错成本落在管理员人工流程上，需在对账页保留备注能力。
- 个人收款码不做长期固定码（决策 5）→ 群里发一次就失效，适合一次性收款；长期摊位建议用「活动摊位」类型的缴费单码。
- 微信内置浏览器无法开摄像头（技术现实）→ 反扫主要面向「双方都开着官网页面」的线下场景。
