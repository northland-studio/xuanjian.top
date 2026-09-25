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
| 7 | 金额口径 | 余额与金额**整数分存储、展示两位小数**（现有浮点数据迁移） |

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
  amount_cents  INTEGER,                    -- 缴费单/指定金额时为定值；收款码可 NULL（由付款方填）
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
  amount_cents  INTEGER NOT NULL,
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
  amount_cents  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid | waived
  paid_tx_id    INTEGER,
  updated_at    TEXT NOT NULL
);
```

**余额整数化**：`users.balance`（浮点）→ 新增 `balance_cents INTEGER`，迁移时 `ROUND(balance*100)`，
展示层 `/100` 保留两位小数；后续所有扣加一律走 `balance_cents`。`transfer` / `checkin` / `shop` /
`claims` / `donation` 的相关读写一并切换。

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

1. **余额整数化迁移**（`users.balance_cents` + 相关读写切换 + 对账校验脚本）
2. 数据表迁移 + 收款码（个人/活动/金库）生成与主扫付款闭环
3. 付款码（反扫）+ 站内相机 + 三级降级
4. 缴费单码（多人各付各的、名单与截止）
5. 风控与审批、管理员对账页
6. QQ 机器人指令
7. 可视化验收（官网截图 + 机器人出码截图）→ 部署 HK 与 115

## 8. 已知取舍

- 不做退款/撤回（决策 4）→ 纠错成本落在管理员人工流程上，需在对账页保留备注能力。
- 个人收款码不做长期固定码（决策 5）→ 群里发一次就失效，适合一次性收款；长期摊位建议用「活动摊位」类型的缴费单码。
- 微信内置浏览器无法开摄像头（技术现实）→ 反扫主要面向「双方都开着官网页面」的线下场景。
