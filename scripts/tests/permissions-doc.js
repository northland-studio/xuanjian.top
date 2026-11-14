/**
 * 生成权限体系交付文档 docs/PERMISSIONS.md（读取代码注册表，保证与实际一致）
 * 用法：node scripts/tests/permissions-doc.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const registry = require(path.join(ROOT, 'lib', 'permissions', 'registry'));
const economy = require(path.join(ROOT, 'lib', 'permissions', 'economy'));

const moduleNames = registry.MODULES;
const byModule = {};
for (const p of registry.PERMISSIONS) (byModule[p.module] = byModule[p.module] || []).push(p);

let registryTable = '| 权限 | 模块 | 说明 | Level 1 基础 | 核心(仅 Level2 可授予) | 状态 |\n|---|---|---|---|---|---|\n';
for (const mod of Object.keys(byModule)) {
    for (const p of byModule[mod]) {
        registryTable += `| \`${p.key}\` | ${moduleNames[mod] || mod} | ${p.description} | ${p.level1 ? '是' : ''} | ${p.protected ? '是' : ''} | ${p.status} |\n`;
    }
}

let templateTable = '| 模板 | 作用域 | 所属模块 | 权限 | 说明 |\n|---|---|---|---|---|\n';
for (const t of registry.ROLE_TEMPLATES) {
    templateTable += `| ${t.name}（\`${t.key}\`） | ${t.scope === 'global' ? '全局' : '模块'} | ${t.module ? (moduleNames[t.module] || t.module) : '-'} | ${(t.permissions || []).map(p => `\`${p}\``).join('<br>')} | ${t.description || ''} |\n`;
}

let economyTable = '| 方法 | 路径（正则） | 所需经济权限 | 说明 |\n|---|---|---|---|\n';
for (const r of economy.listRules()) {
    economyTable += `| ${r.method} | \`${r.pattern}\` | \`${r.permission}\` | ${r.note} |\n`;
}

const doc = `# xuanjian.top 权限组体系（Level + 角色 + 细粒度权限）

> 本文档由 \`scripts/tests/permissions-doc.js\` 依据代码注册表生成，请勿手改表格。
> 最后生成：${new Date().toISOString()}

## 1. 模型

最终有效权限 = **Level 基础权限 ∪ 所有 ACTIVE 角色权限**（并集、无继承、无用户级 allow/deny、无单用户临时授权）。

- **Level**：0 普通成员 / 1 管理员（保留原有全部管理能力）/ 2 超级管理员（\`*\` 全部权限，始终可进入权限中心，不可被普通权限管理员降级或移除）。
- **角色**：全局角色（可配置普通业务模块权限）与模块角色（只能配置所属模块权限）；状态 \`ACTIVE\` / \`DISABLED\` / \`ARCHIVED\`，只有 ACTIVE 参与计算；禁用/归档保留成员与审计，可恢复。
- **权限**：名称 \`模块.资源.操作\`，**全部由后端代码注册**（\`lib/permissions/registry.js\`），管理员不能自创权限名；每一项都有真实后端鉴权点；数据库只持久化定义同步、角色、成员、权限分配与审计。
- **实时计算**：JWT 只做身份；\`middleware/auth.js\` 每次受保护请求实时查库解析权限，无缓存 → 角色成员/角色权限/角色状态/Level/封禁变更**下一次请求立即生效**。
- **账号冻结**：\`users.is_frozen\` 语义保留；封禁后普通/管理/经济权限全部立即失效（403 \`ACCOUNT_FROZEN\`），不删除角色关系；解封自动重算。

## 2. 权限注册表（${registry.PERMISSIONS.length} 项，ACTIVE ${registry.listActiveKeys().length} 项）

${registryTable}

说明：\`DISABLED\` 权限不参与有效权限计算、不可分配；GIS 权限随 \`routes/gis.js\` 落地自动转 ACTIVE，market.* 已接入转 ACTIVE。

## 3. 角色模板（可直接使用，也可复制为独立自定义角色）

${templateTable}

- 系统角色受保护：普通权限管理员不能改名/改权限/改状态（系统角色仅 Level 2 可改），但可以管理成员（不得操作 Level 2 用户）。
- 权限管理员不得修改自己的角色/自己所属角色的权限（防自我提权），不得授予自己没有的 \`admin.*\` 权限，不得授予核心权限。

## 4. 贡献点经济资格（角色决定，与 Level 无关）

- 经济资格权限：\`access\` / \`earn\` / \`spend\` / \`transfer\` / \`manage\`；\`earn/spend/transfer\` 以 \`access\` 为前提；\`manage\` 不自动赋予经济成员资格，也不赋予其它模块权限。
- 无 \`access\`：\`/api/auth/me\` 不返回余额（contribution=null）、流水不可见、不可赚/花/转；余额与历史流水保留，重新获得角色后自动恢复。
- **不写入 \`users.is_frozen\`**（账号冻结与纪律语义独立）。
- 迁移：\`migrations/103_economy_members_backfill.js\` 幂等回填「玄剑经济成员」；系统账号（level=-1）不加入；不改余额/流水/历史交易。
- 全局失败安全：\`economyGate\` 在业务路由前统一校验贡献点入口（下表），防止绕过前端直接调接口；未覆盖入口在遗留清单中列明。

### 经济资格校验规则表

${economyTable}

## 5. 权限中心（并入 /admin，不新建后台）

- 角色列表/搜索/筛选、角色详情、权限编辑（模块分组、核心权限标记、停用权限不可选）、成员管理（角色侧：搜索/批量添加逐条结果/移除）、模板复制、状态管理（禁用/归档/恢复，高风险二次确认）、审计日志（操作者/目标/前后差异/时间）、用户权限溯源（Level、角色及状态、最终有效权限及来源、失效原因）。
- 双向成员管理共用后端服务：角色详情页（角色侧）与用户详情页「权限溯源」弹窗（用户侧）。
- Level 1 拥有 \`admin.permissions.view\`（只读查看权限中心）；写操作需要 \`admin.permissions.manage\`（权限管理员，由 Level 2 指定）。

### UI 验收截图（本地夹具库实测，非生产数据）

| 场景 | 截图 |
|---|---|
| Level 2 角色列表（9 角色 + 新建按钮） | \`docs/permissions-ui/01-level2-role-list.png\` |
| Level 2 角色详情（权限配置/核心权限标记） | \`docs/permissions-ui/02-level2-role-detail.png\` |
| Level 2 角色成员管理 | \`docs/permissions-ui/03-level2-role-members.png\` |
| Level 2 用户权限溯源（Level/角色/有效权限/经济资格） | \`docs/permissions-ui/04-level2-user-trace.png\`、\`05-level2-user-trace-perms.png\` |
| Level 1 权限中心只读（无新建/保存按钮，只读提示） | \`docs/permissions-ui/06-level1-permission-center-readonly.png\` |
| Level 1 角色详情只读（复选框禁用、无状态操作） | \`docs/permissions-ui/07-level1-role-detail-readonly.png\` |

## 6. 统一错误语义

| 场景 | HTTP | 稳定错误码 |
|---|---|---|
| 未登录 / token 无效 | 401 | \`UNAUTHORIZED\` |
| 已登录无权限 | 403 | \`PERMISSION_DENIED\`（含 required） |
| 账号冻结/封禁 | 403 | \`ACCOUNT_FROZEN\` |
| 无经济资格 | 403 | \`ECONOMY_ACCESS_REQUIRED\` |
| 有资格但缺操作权限 | 403 | \`ECONOMY_PERMISSION_REQUIRED\` |
| Level 不足（兼容层） | 403 | \`LEVEL_REQUIRED\` |

## 7. 数据库与迁移

- 表：\`permission_definitions\` / \`permission_roles\` / \`permission_role_permissions\` / \`permission_role_members\` / \`permission_audit_logs\`（唯一约束/外键/索引见 \`lib/permissions/schema.js\`）；**不存在任何单用户直接授权/拒绝表**。
- 迁移：\`migrations/100-104\`（权限）+ \`120-126\`（GIS），执行器 \`migrations/run.js\`（幂等、\`--dry-run\`、\`--backup\`、记录 \`schema_migrations\`）。
- 生产部署与回滚记录：TAG=20261114-perm-013742（部署脚本 \`scripts/deploy-permissions-20261114.sh\`、核对脚本 \`scripts/tests/permissions-prod-{verify,counts}.js\`）。

## 8. 全站受保护 API 迁移状态

见自动生成清单：\`docs/PERMISSIONS-API-INVENTORY.md\`（按鉴权方式分类：细粒度权限已迁移 / Level 兼容层 / 登录用户 / 服务间令牌 / 处理函数内鉴权 / 公开）。

- **已迁移细粒度**：admin（用户/公告/统计/看板/主题）、wiki 全部管理审核、contributions（转账/流水/经济管理/人工调整）、market 全部管理端与商家后台、权限中心、mod 模组经济点、用户 Level 调整。
- **Level 兼容层（真实后端鉴权，未细粒度化）**：banners、chat、checkin、claims、discipline、donation、generations、express-index、faq、oauth、pay、paygate、tasks、team、titles、upload、stock 等；这些接口仍由 Level >= 1 / Level 2 保护，未出现“前端隐藏、后端裸奔”（静态扫描 admin 路径未鉴权数 = 0）。
- **普通业务**：公开浏览/评论/收藏/用户自助接口沿用原有业务规则（登录或公开），不属于特殊授权操作。

## 9. 自动化测试

\`node scripts/tests/run-permissions-tests.js\`：4 组、179 条断言，全部使用临时数据库（复制 data/guild.db 后迁移），不连接生产库。
覆盖规范第二十条 1-19 项 + market.* 权限接入；生产验证脚本见 \`scripts/tests/permissions-prod-verify.js\`（32 项检查）。
`;

const outFile = path.join(ROOT, 'docs', 'PERMISSIONS.md');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, doc);
console.log('已生成:', outFile, `(${doc.length} chars)`);
