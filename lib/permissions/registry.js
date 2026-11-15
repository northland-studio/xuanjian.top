/**
 * 权限注册表（唯一权威来源）
 *
 * 设计要点（见《xuanjian.top 权限组体系升级》）：
 *  - 权限名 = `模块.资源.操作`，**全部由代码注册**；数据库只持久化同步结果。
 *  - 不允许单用户直接授权/拒绝：有效权限 = Level 基础权限 ∪ 所有 ACTIVE 角色权限（并集，无继承）。
 *  - 只有真实存在后端鉴权点的权限才会被注册；尚未接入的模块以 DISABLED 占位，不参与有效权限计算、不可分配。
 *  - 该文件不依赖数据库（纯数据 + 少量文件探测），可被迁移脚本、测试脚本直接 require。
 */
const fs = require('fs');
const path = require('path');

/** 模块定义：module → 展示名（权限中心按模块分组展示） */
const MODULES = {
    admin: '管理后台',
    wiki: 'Wiki',
    gis: 'GIS 地图',
    market: '公会集市',
    announcement: '公告',
    content: '内容',
    economy: '贡献点经济'
};

/** 可选模块：只有当对应路由文件真实存在（即鉴权点已落地）时才 ACTIVE，避免注册“虚假权限” */
const OPTIONAL_MODULE_FILES = {
    gis: '../../routes/gis.js'
};

function moduleAvailable(moduleName) {
    const rel = OPTIONAL_MODULE_FILES[moduleName];
    if (!rel) return true;
    try {
        return fs.existsSync(path.join(__dirname, rel));
    } catch (e) {
        return false;
    }
}

/**
 * 权限注册表
 *  - level1: true 表示 Level 1 管理员基础权限（保留现有全部管理能力）
 *  - protected: true 表示核心权限，只有 Level 2 能把该权限授予角色（普通权限管理员不能突破）
 *  - status: ACTIVE 参与计算；DISABLED 仅保留历史、不参与计算、不可分配
 *  - wiredBy: 真实后端鉴权点位置（供盘点与审计核对；不允许留空）
 */
const PERMISSIONS = [
    // ============ 管理后台 / 用户管理 ============
    {
        key: 'admin.dashboard.view', module: 'admin', resource: 'dashboard', action: 'view',
        description: '查看管理后台数据看板', level1: true, wiredBy: 'routes/admin.js GET /api/admin/dashboard'
    },
    {
        key: 'admin.statistics.view', module: 'admin', resource: 'statistics', action: 'view',
        description: '查看站点统计接口', level1: true, wiredBy: 'routes/admin.js GET /api/admin/statistics'
    },
    {
        key: 'admin.users.view', module: 'admin', resource: 'users', action: 'view',
        description: '查看用户管理数据与用户权限溯源', level1: true, wiredBy: 'routes/admin.js GET /api/admin/users'
    },
    {
        key: 'admin.users.edit', module: 'admin', resource: 'users', action: 'edit',
        description: '修改用户资料（昵称/邮箱/密码）', level1: true, wiredBy: 'routes/admin.js PUT /api/admin/users/:id'
    },
    {
        key: 'admin.users.level', module: 'admin', resource: 'users', action: 'level',
        description: '调整用户 Level 等级（超级管理员专用）', protected: true,
        wiredBy: 'routes/admin.js PUT /api/admin/users/:id/level'
    },
    {
        key: 'admin.posts.moderate', module: 'admin', resource: 'posts', action: 'moderate',
        description: '查看全站内容并置顶/取消置顶', level1: true, wiredBy: 'routes/admin.js GET/PUT /api/admin/posts*'
    },
    {
        key: 'admin.theme.manage', module: 'admin', resource: 'theme', action: 'manage',
        description: '切换站点主题', level1: true, wiredBy: 'routes/admin.js PUT /api/admin/theme'
    },
    {
        key: 'admin.permissions.manage', module: 'admin', resource: 'permissions', action: 'manage',
        description: '权限管理员：管理角色、角色权限、成员与审计（权限中心）', protected: true,
        wiredBy: 'routes/permissions.js 全部管理接口'
    },
    {
        key: 'admin.permissions.view', module: 'admin', resource: 'permissions', action: 'view',
        description: '查看权限中心（角色/权限/审计只读；Level 1 基础权限）', level1: true,
        wiredBy: 'routes/permissions.js GET 接口'
    },

    // ============ Wiki ============
    {
        key: 'wiki.access', module: 'wiki', resource: 'wiki', action: 'access',
        description: '进入 Wiki 管理/审核（查看管理数据、待审队列）', level1: true, wiredBy: 'routes/wiki.js GET /api/wiki/admin/* /stats /submissions*'
    },
    {
        key: 'wiki.page.create', module: 'wiki', resource: 'page', action: 'create',
        description: '直接创建并发布 Wiki 页面（跳过投稿审核）', level1: true, wiredBy: 'routes/wiki.js POST /api/wiki'
    },
    {
        key: 'wiki.page.edit', module: 'wiki', resource: 'page', action: 'edit',
        description: '直接编辑并保存 Wiki 页面（无需审核）', level1: true, wiredBy: 'routes/wiki.js PUT /api/wiki/:id'
    },
    {
        key: 'wiki.page.delete', module: 'wiki', resource: 'page', action: 'delete',
        description: '彻底删除 Wiki 页面（含版本与内链）', protected: true, wiredBy: 'routes/wiki.js DELETE /api/wiki/:id'
    },
    {
        key: 'wiki.page.review', module: 'wiki', resource: 'page', action: 'review',
        description: '审核 Wiki 投稿（通过/驳回/补发奖励）与发布/归档/恢复页面', level1: true,
        wiredBy: 'routes/wiki.js /submissions/:id/* /:id/publish|archive|restore'
    },
    {
        key: 'wiki.category.manage', module: 'wiki', resource: 'category', action: 'manage',
        description: '新建/编辑 Wiki 分类', level1: true, wiredBy: 'routes/wiki.js POST/PUT /api/wiki/categories'
    },
    {
        key: 'wiki.category.delete', module: 'wiki', resource: 'category', action: 'delete',
        description: '删除 Wiki 分类（超级管理员专用）', protected: true, wiredBy: 'routes/wiki.js DELETE /api/wiki/categories/:id'
    },
    {
        key: 'wiki.revision.restore', module: 'wiki', resource: 'revision', action: 'restore',
        description: '恢复 Wiki 历史版本', level1: true, wiredBy: 'routes/wiki.js POST /api/wiki/:id/revisions/:rid/restore'
    },
    {
        key: 'wiki.review.config', module: 'wiki', resource: 'review', action: 'config',
        description: '配置 Wiki 自动审核（GLM）参数', level1: true, wiredBy: 'routes/wiki.js /review-config*'
    },

    // ============ 公告 ============
    {
        key: 'announcement.create', module: 'announcement', resource: 'announcement', action: 'create',
        description: '创建公告', level1: true, wiredBy: 'routes/admin.js POST /api/admin/announcements'
    },
    {
        key: 'announcement.edit', module: 'announcement', resource: 'announcement', action: 'edit',
        description: '编辑公告', level1: true, wiredBy: 'routes/admin.js PUT /api/admin/announcements/:id'
    },
    {
        key: 'announcement.publish', module: 'announcement', resource: 'announcement', action: 'publish',
        description: '发布/上线公告（isActive 置为真）', level1: true, wiredBy: 'routes/admin.js PUT /api/admin/announcements/:id (isActive)'
    },
    {
        key: 'announcement.delete', module: 'announcement', resource: 'announcement', action: 'delete',
        description: '删除公告', level1: true, wiredBy: 'routes/admin.js DELETE /api/admin/announcements/:id'
    },
    {
        key: 'content.daily.publish', module: 'content', resource: 'daily', action: 'publish',
        description: '发布/编辑公会日报（无需 Level 1，用于外会官号等特殊角色）', level1: true,
        wiredBy: 'routes/posts.js POST /api/posts (type=daily)'
    },

    // ============ 贡献点经济 ============
    {
        key: 'economy.contribution_points.access', module: 'economy', resource: 'contribution_points', action: 'access',
        description: '贡献点账户准入：查看自己的余额与流水（经济成员角色授予，与 Level 无关）',
        wiredBy: 'routes/contributions.js GET /api/contributions/logs + economyGate'
    },
    {
        key: 'economy.contribution_points.earn', module: 'economy', resource: 'contribution_points', action: 'earn',
        description: '获取贡献点（签到/任务等，需同时具备 access）',
        wiredBy: 'economyGate + routes/contributions.js'
    },
    {
        key: 'economy.contribution_points.spend', module: 'economy', resource: 'contribution_points', action: 'spend',
        description: '消费贡献点（商城/头衔/集市等，需同时具备 access）',
        wiredBy: 'economyGate'
    },
    {
        key: 'economy.contribution_points.transfer', module: 'economy', resource: 'contribution_points', action: 'transfer',
        description: '转账贡献点（需同时具备 access）',
        wiredBy: 'routes/contributions.js POST /api/contributions/transfer'
    },
    {
        key: 'economy.contribution_points.manage', module: 'economy', resource: 'contribution_points', action: 'manage',
        description: '全局经济管理：查看所有账户流水、人工调整贡献点（不赋予其它模块权限）', protected: true,
        wiredBy: 'routes/contributions.js PUT /api/contributions/admin/:userId + adminOrPermission 读接口'
    },

    // ============ GIS（由 gis-platform 路由接入；文件不存在时自动 DISABLED） ============
    {
        key: 'gis.access', module: 'gis', resource: 'gis', action: 'access',
        description: '进入 GIS 管理与查看管理数据', wiredBy: 'routes/gis.js'
    },
    {
        key: 'gis.submit', module: 'gis', resource: 'gis', action: 'submit',
        description: '提交 GIS 草稿数据（模组/网页上传）', wiredBy: 'routes/gis.js'
    },
    {
        key: 'gis.road.edit', module: 'gis', resource: 'road', action: 'edit',
        description: '编辑 GIS 道路', wiredBy: 'routes/gis.js'
    },
    {
        key: 'gis.district.edit', module: 'gis', resource: 'district', action: 'edit',
        description: '编辑 GIS 城区', wiredBy: 'routes/gis.js'
    },
    {
        key: 'gis.object.review', module: 'gis', resource: 'object', action: 'review',
        description: '审核 GIS 提交与发布', wiredBy: 'routes/gis.js'
    },
    {
        key: 'gis.admin', module: 'gis', resource: 'gis', action: 'admin',
        description: 'GIS 全局管理（世界注册、地形、快照、配置）', level1: true, wiredBy: 'routes/gis.js'
    },

    // ============ 公会集市（已注册，待 market.js 释放后接入 → 届时改 status） ============
    {
        key: 'market.access', module: 'market', resource: 'market', action: 'access',
        description: '进入集市管理与商家经营后台', wiredBy: 'routes/market.js /api/market/merchant/**（商家经营后台）'
    },
    {
        key: 'market.product.review', module: 'market', resource: 'product', action: 'review',
        description: '审核集市店铺/商品上架', wiredBy: 'routes/market.js GET /api/market/admin/stores + POST /admin/stores/:id/review'
    },
    {
        key: 'market.shop.manage', module: 'market', resource: 'shop', action: 'manage',
        description: '集市店铺管理（状态/分类/配置）', wiredBy: 'routes/market.js POST /admin/stores/:id/status + /admin/categories* + /admin/audit + /admin/jobs/run + /admin/notify/*'
    },
    {
        key: 'market.order.manage', module: 'market', resource: 'order', action: 'manage',
        description: '集市订单管理（人工退款/核销异常）', wiredBy: 'routes/market.js GET /api/market/admin/orders + POST /admin/orders/:id/refund + /admin/archives'
    },
    {
        key: 'market.dispute.manage', module: 'market', resource: 'dispute', action: 'manage',
        description: '集市争议裁决', wiredBy: 'routes/market.js GET /api/market/admin/disputes + POST /admin/disputes/:id/resolve'
    },
    {
        key: 'market.finance.manage', module: 'market', resource: 'finance', action: 'manage',
        description: '集市财政分户账、费率税务与人工调账', wiredBy: 'routes/market.js /api/market/admin/config* + /admin/finance* + /admin/reconcile'
    }
];

/** Level 基础权限（Level 0 额外包含 gis.submit：普通成员可提交 GIS 草稿，发布仍需 gis.object.review 审核） */
const LEVEL_BASE = {
    0: ['gis.submit'],
    1: PERMISSIONS.filter(p => p.level1).map(p => p.key),
    2: ['*']
};

/** 系统模板（少量；可复制为自定义角色，复制后独立；不设计模板市场） */
const ROLE_TEMPLATES = [
    {
        key: 'wiki_editor', name: 'Wiki 编辑员', scope: 'module', module: 'wiki',
        description: '可直接创建/编辑 Wiki 页面',
        permissions: ['wiki.access', 'wiki.page.create', 'wiki.page.edit']
    },
    {
        key: 'wiki_admin', name: 'Wiki 管理员', scope: 'module', module: 'wiki',
        description: 'Wiki 全量管理（除删除页面/分类等核心权限外）',
        permissions: ['wiki.access', 'wiki.page.create', 'wiki.page.edit', 'wiki.page.review',
            'wiki.category.manage', 'wiki.revision.restore', 'wiki.review.config']
    },
    {
        key: 'gis_editor', name: 'GIS 编辑员', scope: 'module', module: 'gis',
        description: '绘制并提交 GIS 道路/城区',
        permissions: ['gis.access', 'gis.submit', 'gis.road.edit', 'gis.district.edit']
    },
    {
        key: 'gis_admin', name: 'GIS 管理员', scope: 'module', module: 'gis',
        description: 'GIS 审核与全局管理',
        permissions: ['gis.access', 'gis.submit', 'gis.road.edit', 'gis.district.edit',
            'gis.object.review', 'gis.admin']
    },
    {
        key: 'market_reviewer', name: '集市审核员', scope: 'module', module: 'market',
        description: '审核集市店铺与商品',
        permissions: ['market.access', 'market.product.review']
    },
    {
        key: 'market_admin', name: '集市管理员', scope: 'module', module: 'market',
        description: '集市全量管理',
        permissions: ['market.access', 'market.product.review', 'market.shop.manage',
            'market.order.manage', 'market.dispute.manage', 'market.finance.manage']
    },
    {
        key: 'economy_member', name: '玄剑经济成员', scope: 'module', module: 'economy',
        description: '参与玄剑贡献点经济（查看余额流水、获取、消费、转账）',
        permissions: ['economy.contribution_points.access', 'economy.contribution_points.earn',
            'economy.contribution_points.spend', 'economy.contribution_points.transfer']
    },
    {
        key: 'economy_admin', name: '经济管理员', scope: 'module', module: 'economy',
        description: '全局经济管理（人工调整、全局账目），不自动获得经济成员资格',
        permissions: ['economy.contribution_points.manage']
    },
    {
        key: 'permission_admin', name: '权限管理员', scope: 'global', module: null,
        description: '管理全站非超级管理员用户的角色与角色权限（由 Level 2 指定）',
        permissions: ['admin.permissions.manage']
    }
];

const PERMISSION_MAP = new Map(PERMISSIONS.map(p => [p.key, p]));

/** 兼容：GIS 等可选模块路由文件不存在时，其权限自动降级为 DISABLED */
for (const p of PERMISSIONS) {
    if (!p.status && p.module && OPTIONAL_MODULE_FILES[p.module] && !moduleAvailable(p.module)) {
        p.status = 'DISABLED';
    }
    if (!p.status) p.status = 'ACTIVE';
}

function getDefinition(key) {
    return PERMISSION_MAP.get(key) || null;
}

function isRegistered(key) {
    return PERMISSION_MAP.has(key);
}

function isActive(key) {
    const p = PERMISSION_MAP.get(key);
    return !!p && p.status === 'ACTIVE';
}

function isProtected(key) {
    const p = PERMISSION_MAP.get(key);
    return !!p && !!p.protected;
}

function listActivePermissions() {
    return PERMISSIONS.filter(p => p.status === 'ACTIVE');
}

function listActiveKeys() {
    return listActivePermissions().map(p => p.key);
}

/** Level 基础权限列表（* 表示全部；level < 0 为系统账号，不参与用户级权限） */
function basePermissionsOfLevel(level) {
    const lv = Number(level);
    if (Number.isNaN(lv) || lv < 0) return [];
    if (lv >= 2) return ['*'];
    if (lv === 1) return LEVEL_BASE[1].filter(isActive);
    return LEVEL_BASE[0].filter(isActive);
}

function getTemplate(key) {
    return ROLE_TEMPLATES.find(t => t.key === key) || null;
}

function permissionsOfModule(moduleName) {
    return listActivePermissions().filter(p => p.module === moduleName);
}

module.exports = {
    MODULES,
    PERMISSIONS,
    LEVEL_BASE,
    ROLE_TEMPLATES,
    getDefinition,
    isRegistered,
    isActive,
    isProtected,
    listActivePermissions,
    listActiveKeys,
    basePermissionsOfLevel,
    getTemplate,
    permissionsOfModule,
    moduleAvailable
};
