# xuanjian.top 权限组体系（Level + 角色 + 细粒度权限）

> 本文档由 `scripts/tests/permissions-doc.js` 依据代码注册表生成，请勿手改表格。
> 最后生成：2026-11-15T04:55:20.345Z

## 1. 模型

最终有效权限 = **Level 基础权限 ∪ 所有 ACTIVE 角色权限**（并集、无继承、无用户级 allow/deny、无单用户临时授权）。

- **Level**：0 普通成员 / 1 管理员（保留原有全部管理能力）/ 2 超级管理员（`*` 全部权限，始终可进入权限中心，不可被普通权限管理员降级或移除）。
- **角色**：全局角色（可配置普通业务模块权限）与模块角色（只能配置所属模块权限）；状态 `ACTIVE` / `DISABLED` / `ARCHIVED`，只有 ACTIVE 参与计算；禁用/归档保留成员与审计，可恢复。
- **权限**：名称 `模块.资源.操作`，**全部由后端代码注册**（`lib/permissions/registry.js`），管理员不能自创权限名；每一项都有真实后端鉴权点；数据库只持久化定义同步、角色、成员、权限分配与审计。
- **实时计算**：JWT 只做身份；`middleware/auth.js` 每次受保护请求实时查库解析权限，无缓存 → 角色成员/角色权限/角色状态/Level/封禁变更**下一次请求立即生效**。
- **账号冻结**：`users.is_frozen` 语义保留；封禁后普通/管理/经济权限全部立即失效（403 `ACCOUNT_FROZEN`），不删除角色关系；解封自动重算。

## 2. 权限注册表（40 项，ACTIVE 40 项）

| 权限 | 模块 | 说明 | Level 1 基础 | 核心(仅 Level2 可授予) | 状态 |
|---|---|---|---|---|---|
| `admin.dashboard.view` | 管理后台 | 查看管理后台数据看板 | 是 |  | ACTIVE |
| `admin.statistics.view` | 管理后台 | 查看站点统计接口 | 是 |  | ACTIVE |
| `admin.users.view` | 管理后台 | 查看用户管理数据与用户权限溯源 | 是 |  | ACTIVE |
| `admin.users.edit` | 管理后台 | 修改用户资料（昵称/邮箱/密码） | 是 |  | ACTIVE |
| `admin.users.level` | 管理后台 | 调整用户 Level 等级（超级管理员专用） |  | 是 | ACTIVE |
| `admin.posts.moderate` | 管理后台 | 查看全站内容并置顶/取消置顶 | 是 |  | ACTIVE |
| `admin.theme.manage` | 管理后台 | 切换站点主题 | 是 |  | ACTIVE |
| `admin.permissions.manage` | 管理后台 | 权限管理员：管理角色、角色权限、成员与审计（权限中心） |  | 是 | ACTIVE |
| `admin.permissions.view` | 管理后台 | 查看权限中心（角色/权限/审计只读；Level 1 基础权限） | 是 |  | ACTIVE |
| `wiki.access` | Wiki | 进入 Wiki 管理/审核（查看管理数据、待审队列） | 是 |  | ACTIVE |
| `wiki.page.create` | Wiki | 直接创建并发布 Wiki 页面（跳过投稿审核） | 是 |  | ACTIVE |
| `wiki.page.edit` | Wiki | 直接编辑并保存 Wiki 页面（无需审核） | 是 |  | ACTIVE |
| `wiki.page.delete` | Wiki | 彻底删除 Wiki 页面（含版本与内链） |  | 是 | ACTIVE |
| `wiki.page.review` | Wiki | 审核 Wiki 投稿（通过/驳回/补发奖励）与发布/归档/恢复页面 | 是 |  | ACTIVE |
| `wiki.category.manage` | Wiki | 新建/编辑 Wiki 分类 | 是 |  | ACTIVE |
| `wiki.category.delete` | Wiki | 删除 Wiki 分类（超级管理员专用） |  | 是 | ACTIVE |
| `wiki.revision.restore` | Wiki | 恢复 Wiki 历史版本 | 是 |  | ACTIVE |
| `wiki.review.config` | Wiki | 配置 Wiki 自动审核（GLM）参数 | 是 |  | ACTIVE |
| `announcement.create` | 公告 | 创建公告 | 是 |  | ACTIVE |
| `announcement.edit` | 公告 | 编辑公告 | 是 |  | ACTIVE |
| `announcement.publish` | 公告 | 发布/上线公告（isActive 置为真） | 是 |  | ACTIVE |
| `announcement.delete` | 公告 | 删除公告 | 是 |  | ACTIVE |
| `content.daily.publish` | 内容 | 发布/编辑公会日报（无需 Level 1，用于外会官号等特殊角色） | 是 |  | ACTIVE |
| `economy.contribution_points.access` | 贡献点经济 | 贡献点账户准入：查看自己的余额与流水（经济成员角色授予，与 Level 无关） |  |  | ACTIVE |
| `economy.contribution_points.earn` | 贡献点经济 | 获取贡献点（签到/任务等，需同时具备 access） |  |  | ACTIVE |
| `economy.contribution_points.spend` | 贡献点经济 | 消费贡献点（商城/头衔/集市等，需同时具备 access） |  |  | ACTIVE |
| `economy.contribution_points.transfer` | 贡献点经济 | 转账贡献点（需同时具备 access） |  |  | ACTIVE |
| `economy.contribution_points.manage` | 贡献点经济 | 全局经济管理：查看所有账户流水、人工调整贡献点（不赋予其它模块权限） |  | 是 | ACTIVE |
| `gis.access` | GIS 地图 | 进入 GIS 管理与查看管理数据 |  |  | ACTIVE |
| `gis.submit` | GIS 地图 | 提交 GIS 草稿数据（模组/网页上传） |  |  | ACTIVE |
| `gis.road.edit` | GIS 地图 | 编辑 GIS 道路 |  |  | ACTIVE |
| `gis.district.edit` | GIS 地图 | 编辑 GIS 城区 |  |  | ACTIVE |
| `gis.object.review` | GIS 地图 | 审核 GIS 提交与发布 |  |  | ACTIVE |
| `gis.admin` | GIS 地图 | GIS 全局管理（世界注册、地形、快照、配置） | 是 |  | ACTIVE |
| `market.access` | 公会集市 | 进入集市管理与商家经营后台 |  |  | ACTIVE |
| `market.product.review` | 公会集市 | 审核集市店铺/商品上架 |  |  | ACTIVE |
| `market.shop.manage` | 公会集市 | 集市店铺管理（状态/分类/配置） |  |  | ACTIVE |
| `market.order.manage` | 公会集市 | 集市订单管理（人工退款/核销异常） |  |  | ACTIVE |
| `market.dispute.manage` | 公会集市 | 集市争议裁决 |  |  | ACTIVE |
| `market.finance.manage` | 公会集市 | 集市财政分户账、费率税务与人工调账 |  |  | ACTIVE |


说明：`DISABLED` 权限不参与有效权限计算、不可分配；GIS 权限随 `routes/gis.js` 落地自动转 ACTIVE，market.* 已接入转 ACTIVE。

## 3. 角色模板（可直接使用，也可复制为独立自定义角色）

| 模板 | 作用域 | 所属模块 | 权限 | 说明 |
|---|---|---|---|---|
| Wiki 编辑员（`wiki_editor`） | 模块 | Wiki | `wiki.access`<br>`wiki.page.create`<br>`wiki.page.edit` | 可直接创建/编辑 Wiki 页面 |
| Wiki 管理员（`wiki_admin`） | 模块 | Wiki | `wiki.access`<br>`wiki.page.create`<br>`wiki.page.edit`<br>`wiki.page.review`<br>`wiki.category.manage`<br>`wiki.revision.restore`<br>`wiki.review.config` | Wiki 全量管理（除删除页面/分类等核心权限外） |
| GIS 编辑员（`gis_editor`） | 模块 | GIS 地图 | `gis.access`<br>`gis.submit`<br>`gis.road.edit`<br>`gis.district.edit` | 绘制并提交 GIS 道路/城区 |
| GIS 管理员（`gis_admin`） | 模块 | GIS 地图 | `gis.access`<br>`gis.submit`<br>`gis.road.edit`<br>`gis.district.edit`<br>`gis.object.review`<br>`gis.admin` | GIS 审核与全局管理 |
| 集市审核员（`market_reviewer`） | 模块 | 公会集市 | `market.access`<br>`market.product.review` | 审核集市店铺与商品 |
| 集市管理员（`market_admin`） | 模块 | 公会集市 | `market.access`<br>`market.product.review`<br>`market.shop.manage`<br>`market.order.manage`<br>`market.dispute.manage`<br>`market.finance.manage` | 集市全量管理 |
| 玄剑经济成员（`economy_member`） | 模块 | 贡献点经济 | `economy.contribution_points.access`<br>`economy.contribution_points.earn`<br>`economy.contribution_points.spend`<br>`economy.contribution_points.transfer` | 参与玄剑贡献点经济（查看余额流水、获取、消费、转账） |
| 经济管理员（`economy_admin`） | 模块 | 贡献点经济 | `economy.contribution_points.manage` | 全局经济管理（人工调整、全局账目），不自动获得经济成员资格 |
| 权限管理员（`permission_admin`） | 全局 | - | `admin.permissions.manage` | 管理全站非超级管理员用户的角色与角色权限（由 Level 2 指定） |


- 系统角色受保护：普通权限管理员不能改名/改权限/改状态（系统角色仅 Level 2 可改），但可以管理成员（不得操作 Level 2 用户）。
- 权限管理员不得修改自己的角色/自己所属角色的权限（防自我提权），不得授予自己没有的 `admin.*` 权限，不得授予核心权限。

## 4. 贡献点经济资格（角色决定，与 Level 无关）

- 经济资格权限：`access` / `earn` / `spend` / `transfer` / `manage`；`earn/spend/transfer` 以 `access` 为前提；`manage` 不自动赋予经济成员资格，也不赋予其它模块权限。
- 无 `access`：`/api/auth/me` 不返回余额（contribution=null）、流水不可见、不可赚/花/转；余额与历史流水保留，重新获得角色后自动恢复。
- **不写入 `users.is_frozen`**（账号冻结与纪律语义独立）。
- 迁移：`migrations/103_economy_members_backfill.js` 幂等回填「玄剑经济成员」；系统账号（level=-1）不加入；不改余额/流水/历史交易。
- 全局失败安全：`economyGate` 在业务路由前统一校验贡献点入口（下表），防止绕过前端直接调接口；未覆盖入口在遗留清单中列明。

### 集市下单口径（重要，避免误解）

- `POST /api/market/orders` = **已登录 + `economy.contribution_points.access` + `economy.contribution_points.spend`**（economyGate 前置 + 服务层订单/库存/限购校验）。
- `market.access` 只负责**商家经营后台与管理面**（模块角色，不能跨模块塞进「玄剑经济成员」角色）。
- 即：下单 **不需要** `market.access`；外会人员（无经济资格）浏览集市正常、下单被 403 `ECONOMY_ACCESS_REQUIRED`。

### 经济资格校验规则表

| 方法 | 路径（正则） | 所需经济权限 | 说明 |
|---|---|---|---|
| GET | `^\/api\/contributions\/logs$` | `economy.contribution_points.access` | 查看自己的贡献点流水 |
| GET | `^\/api\/checkin\/status$` | `economy.contribution_points.access` | 签到状态（返回贡献点余额相关） |
| GET | `^\/api\/checkin\/history$` | `economy.contribution_points.access` | 签到历史（含贡献点奖励） |
| GET | `^\/api\/pay\/records$` | `economy.contribution_points.access` | 扫码支付记录（贡献点） |
| GET | `^\/api\/pay\/members$` | `economy.contribution_points.access` | 支付成员列表（贡献点） |
| GET | `^\/api\/pay\/charges$` | `economy.contribution_points.access` | 缴费单列表（贡献点） |
| GET | `^\/api\/pay\/payer-code\/current$` | `economy.contribution_points.access` | 付款码（贡献点余额展示） |
| GET | `^\/api\/pay\/payer-code\/pending$` | `economy.contribution_points.access` | 待支付付款码（贡献点） |
| GET | `^\/api\/pay\/intents\/[^/]+$` | `economy.contribution_points.access` | 支付单详情（贡献点） |
| POST | `^\/api\/checkin\/checkin$` | `economy.contribution_points.earn` | 签到获得贡献点 |
| POST | `^\/api\/checkin\/makeup$` | `economy.contribution_points.earn` | 补签获得贡献点 |
| POST | `^\/api\/tasks\/\d+\/complete$` | `economy.contribution_points.earn` | 完成任务获得贡献点 |
| POST | `^\/api\/player-tasks\/\d+\/complete$` | `economy.contribution_points.earn` | 完成玩家任务获得贡献点 |
| POST | `^\/api\/express-index\/sell$` | `economy.contribution_points.earn` | 股市卖出获得贡献点 |
| POST | `^\/api\/checkin\/buy-makeup-card$` | `economy.contribution_points.spend` | 购买补签卡 |
| POST | `^\/api\/shop\/items\/\d+\/buy$` | `economy.contribution_points.spend` | 商城购买 |
| POST | `^\/api\/titles\/\d+\/buy$` | `economy.contribution_points.spend` | 购买头衔 |
| POST | `^\/api\/chat\/bubbles\/\d+\/buy$` | `economy.contribution_points.spend` | 购买聊天气泡 |
| POST | `^\/api\/player-tasks$` | `economy.contribution_points.spend` | 发布玩家任务（托管贡献点） |
| POST | `^\/api\/market\/orders$` | `economy.contribution_points.spend` | 集市下单支付贡献点 |
| POST | `^\/api\/express-index\/buy$` | `economy.contribution_points.spend` | 股市买入扣除贡献点 |
| POST | `^\/api\/contribution-conversion\/\d+\/apply$` | `economy.contribution_points.spend` | 换服折算（贡献点） |
| POST | `^\/api\/pay\/scan$` | `economy.contribution_points.spend` | 扫码支付贡献点 |
| POST | `^\/api\/pay\/intents\/[^/]+\/confirm$` | `economy.contribution_points.spend` | 确认支付贡献点 |
| POST | `^\/api\/pay\/charge\/[^/]+\/pay$` | `economy.contribution_points.spend` | 缴费单支付贡献点 |
| POST | `^\/api\/contributions\/transfer$` | `economy.contribution_points.transfer` | 贡献点转账 |


## 5. 权限中心（并入 /admin，不新建后台）

- 角色列表/搜索/筛选、角色详情、权限编辑（模块分组、核心权限标记、停用权限不可选）、成员管理（角色侧：搜索/批量添加逐条结果/移除）、模板复制、状态管理（禁用/归档/恢复，高风险二次确认）、审计日志（操作者/目标/前后差异/时间）、用户权限溯源（Level、角色及状态、最终有效权限及来源、失效原因）。
- 双向成员管理共用后端服务：角色详情页（角色侧）与用户详情页「权限溯源」弹窗（用户侧）。
- Level 1 拥有 `admin.permissions.view`（只读查看权限中心）；写操作需要 `admin.permissions.manage`（权限管理员，由 Level 2 指定）。

### UI 验收截图（本地夹具库实测，非生产数据）

| 场景 | 截图 |
|---|---|
| Level 2 角色列表（9 角色 + 新建按钮） | `docs/permissions-ui/01-level2-role-list.png` |
| Level 2 角色详情（权限配置/核心权限标记） | `docs/permissions-ui/02-level2-role-detail.png` |
| Level 2 角色成员管理 | `docs/permissions-ui/03-level2-role-members.png` |
| Level 2 用户权限溯源（Level/角色/有效权限/经济资格） | `docs/permissions-ui/04-level2-user-trace.png`、`05-level2-user-trace-perms.png` |
| Level 1 权限中心只读（无新建/保存按钮，只读提示） | `docs/permissions-ui/06-level1-permission-center-readonly.png` |
| Level 1 角色详情只读（复选框禁用、无状态操作） | `docs/permissions-ui/07-level1-role-detail-readonly.png` |

## 6. 统一错误语义

| 场景 | HTTP | 稳定错误码 |
|---|---|---|
| 未登录 / token 无效 | 401 | `UNAUTHORIZED` |
| 已登录无权限 | 403 | `PERMISSION_DENIED`（含 required） |
| 账号冻结/封禁 | 403 | `ACCOUNT_FROZEN` |
| 无经济资格 | 403 | `ECONOMY_ACCESS_REQUIRED` |
| 有资格但缺操作权限 | 403 | `ECONOMY_PERMISSION_REQUIRED` |
| Level 不足（兼容层） | 403 | `LEVEL_REQUIRED` |

## 7. 数据库与迁移

- 表：`permission_definitions` / `permission_roles` / `permission_role_permissions` / `permission_role_members` / `permission_audit_logs`（唯一约束/外键/索引见 `lib/permissions/schema.js`）；**不存在任何单用户直接授权/拒绝表**。
- 迁移：`migrations/100-104`（权限）+ `120-126`（GIS），执行器 `migrations/run.js`（幂等、`--dry-run`、`--backup`、记录 `schema_migrations`）。
- 生产部署与回滚记录：TAG=20261114-perm-013742（权限体系全量首发，12 个迁移 100-126）、TAG=market-20261115-014842（market.* 权限增量，2 个后端文件、无迁移）；部署脚本 `scripts/deploy-permissions-20261114.sh` / `scripts/deploy-market-20261115.sh`，核对脚本 `scripts/tests/permissions-prod-{verify,counts,market-verify,market-postcheck}.js`。

## 8. 全站受保护 API 迁移状态

见自动生成清单：`docs/PERMISSIONS-API-INVENTORY.md`（按鉴权方式分类：细粒度权限已迁移 / Level 兼容层 / 登录用户 / 服务间令牌 / 处理函数内鉴权 / 公开）。

当前口径（`node scripts/tests/permissions-api-inventory.js` 自动统计，共 535 条路由）：**细粒度权限已迁移 107 条 / Level 兼容层 114 条（admin 110 + superAdmin 4）/ 公开 175 条（公开 155 + 可选登录 18 + 仅限流 2）/ 登录用户 123 条 / 服务间与玩家令牌 15 条 / 处理函数内鉴权 1 条**。
抽样验证方式：Level 兼容接口用 Level 1 / Level 2 账号对比 Level 0 账号请求（200 vs 403）；细粒度接口用「无角色 → 403、授予模块角色 → 200、撤销/禁用角色 → 下一次请求 403」验证；静态扫描含 admin 路径未鉴权数 = 0。

- **已迁移细粒度**：admin（用户/公告/统计/看板/主题）、wiki 全部管理审核、contributions（转账/流水/经济管理/人工调整）、market 全部管理端与商家后台、权限中心、mod 模组经济点、用户 Level 调整。
- **Level 兼容层（真实后端鉴权，未细粒度化）**：banners、chat、checkin、claims、discipline、donation、generations、express-index、faq、oauth、pay、paygate、tasks、team、titles、upload、stock 等；这些接口仍由 Level >= 1 / Level 2 保护，未出现“前端隐藏、后端裸奔”（静态扫描 admin 路径未鉴权数 = 0）。
- **普通业务**：公开浏览/评论/收藏/用户自助接口沿用原有业务规则（登录或公开），不属于特殊授权操作。

## 9. 自动化测试

`node scripts/tests/run-permissions-tests.js`：4 组、179 条断言，全部使用临时数据库（复制 data/guild.db 后迁移），不连接生产库。
覆盖规范第二十条 1-19 项 + market.* 权限接入；生产验证脚本：`permissions-prod-verify.js`（32 项）、`permissions-prod-market-verify.js`（9 项）、`permissions-prod-market-postcheck.js`（21 项，含 GIS 字段保留与集市表数据不变量）。
