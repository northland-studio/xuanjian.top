/**
 * 集市（market.*）细粒度权限测试
 *
 * 运行：node scripts/tests/permissions-market.js
 * 使用临时数据库（含集市迁移，不触碰生产库）。
 *
 * 覆盖：
 *  - market.* 6 个权限均为 ACTIVE 且已登记真实鉴权点（无“待接入”假权限）
 *  - 静态审计：/api/market/admin/* 全部走 adminOrPermission(具体权限)；/api/market/merchant/* 全部走 market.access
 *  - 动态：Level1 兼容能力不减少；Level0 无角色 403；集市审核员/管理员角色按最小权限生效
 *  - 下单接口经济资格双校验（ACCESS/SPEND 由 economyGate 前置）
 */
const fs = require('fs');
const path = require('path');
const h = require('./permissions-harness');

const ROOT = path.join(__dirname, '..', '..');

function staticAudit() {
    const src = fs.readFileSync(path.join(ROOT, 'routes', 'market.js'), 'utf8');
    const lines = src.split(/\r?\n/);
    const adminRoutes = lines.filter(l => /^router\.(get|post|put|delete)\('\/admin\//.test(l));
    const merchantRoutes = lines.filter(l => /^router\.(get|post|put|delete)\('\/merchant\//.test(l));
    const adminBad = adminRoutes.filter(l => !/adminOrPermission\('market\./.test(l));
    const merchantBad = merchantRoutes.filter(l => !/adminOrPermission\('market\.access'\)/.test(l));
    return { adminRoutes, merchantRoutes, adminBad, merchantBad };
}

(async () => {
    const t = h.createAssert();
    const env = await h.setup('market');
    const { api, db, createUser, getRoleId } = env;

    try {
        const registry = require('../../lib/permissions/registry');
        const economyRules = require('../../lib/permissions/economy');

        /* ================= 静态审计 ================= */
        t.section('market.* 权限注册与鉴权点静态审计');
        const marketPerms = registry.PERMISSIONS.filter(p => p.module === 'market');
        t.check('market 权限共 6 个', marketPerms.length === 6, marketPerms.map(p => p.key));
        t.check('market 权限全部 ACTIVE（不再是占位）', marketPerms.every(p => p.status === 'ACTIVE'), marketPerms.filter(p => p.status !== 'ACTIVE').map(p => p.key));
        t.check('market 权限均已登记真实鉴权点（无“待接入”）', marketPerms.every(p => p.wiredBy && !/待接入/.test(p.wiredBy)), marketPerms.map(p => p.wiredBy));

        const audit = staticAudit();
        t.check('/api/market/admin/* 全部接入细粒度权限', audit.adminRoutes.length >= 18 && audit.adminBad.length === 0,
            audit.adminBad.map(l => l.trim().slice(0, 90)));
        t.check('/api/market/merchant/* 全部要求 market.access', audit.merchantRoutes.length >= 18 && audit.merchantBad.length === 0,
            audit.merchantBad.map(l => l.trim().slice(0, 90)));
        const orderRule = economyRules.listRules().find(r => r.method === 'POST' && r.pattern === '^\\/api\\/market\\/orders$');
        t.check('POST /api/market/orders 有经济资格规则（spend，access 前提）', !!orderRule && orderRule.perm === 'spend', orderRule);

        const templates = registry.ROLE_TEMPLATES.filter(x => x.module === 'market');
        t.check('集市角色模板存在（审核员/管理员）且只含 market 权限',
            templates.length === 2 && templates.every(tpl => tpl.permissions.every(k => registry.getDefinition(k).module === 'market')),
            templates.map(x => x.key));

        /* ================= 动态接口 ================= */
        t.section('market.* 动态权限验证（真实集市路由）');
        const superUser = await createUser({ level: 2 });
        const admin1 = await createUser({ level: 1 });
        const plain = await createUser({ level: 0 });
        const reviewer = await createUser({ level: 0 });
        const marketAdmin = await createUser({ level: 0 });
        const merchantUser = await createUser({ level: 0 });
        const S = superUser.token;

        const grant = (userId, roleId) => api('POST', `/api/permissions/roles/${roleId}/members`, { token: S, body: { user_ids: [userId] } });
        await grant(reviewer.id, await getRoleId('market_reviewer'));
        await grant(marketAdmin.id, await getRoleId('market_admin'));

        // 只含 market.access 的自定义角色（验证最小权限）
        let r = await api('POST', '/api/permissions/roles', {
            token: S, body: { name: '集市准入角色' + Date.now(), scope: 'module', module: 'market', permissions: ['market.access'] }
        });
        t.check('可创建仅 market.access 的集市角色', r.status === 201, r.data);
        await grant(merchantUser.id, r.data.role.id);

        // 公开浏览不受影响
        r = await api('GET', '/api/market/stores');
        t.check('匿名可正常浏览集市店铺（公开规则不变）', r.status === 200, r.status);
        r = await api('GET', '/api/market/config');
        t.check('匿名可读取集市配置（公开规则不变）', r.status === 200, r.status);

        // 管理端
        r = await api('GET', '/api/market/admin/stores', {});
        t.check('匿名访问集市管理端 → 401', r.status === 401, r.status);
        r = await api('GET', '/api/market/admin/stores', { token: admin1.token });
        t.check('Level 1 保留集市管理能力（兼容层，200）', r.status === 200, r.status);
        r = await api('GET', '/api/market/admin/stores', { token: plain.token });
        t.check('Level 0 无角色访问集市管理端 → 403', r.status === 403, r.status);
        r = await api('GET', '/api/market/admin/stores', { token: reviewer.token });
        t.check('集市审核员角色可查看审核列表（200）', r.status === 200, r.status);
        r = await api('GET', '/api/market/admin/finance', { token: reviewer.token });
        t.check('集市审核员无财政权限（403，最小权限）', r.status === 403, r.status);
        r = await api('GET', '/api/market/admin/finance', { token: marketAdmin.token });
        t.check('集市管理员可查看财政分户账（200）', r.status === 200, r.status);
        r = await api('GET', '/api/market/admin/config', { token: marketAdmin.token });
        t.check('集市管理员可读取费率税务配置（200）', r.status === 200, r.status);
        r = await api('GET', '/api/market/admin/reconcile', { token: marketAdmin.token });
        t.check('集市管理员可做对账（200）', r.status === 200, r.status);
        r = await api('GET', '/api/market/admin/disputes', { token: marketAdmin.token });
        t.check('集市管理员可查看争议（200）', r.status === 200, r.status);
        r = await api('GET', '/api/market/admin/orders', { token: marketAdmin.token });
        t.check('集市管理员可查看订单管理（200）', r.status === 200, r.status);

        // 商家侧：market.access 准入（Level>=1 兼容 + 角色）
        r = await api('GET', '/api/market/merchant/stores', { token: plain.token });
        t.check('无 market.access 访问商家后台 → 403', r.status === 403, r.status);
        r = await api('GET', '/api/market/merchant/stores', { token: merchantUser.token });
        t.check('仅 market.access 角色可进入商家后台（200）', r.status === 200, r.status);
        r = await api('GET', '/api/market/merchant/finance', { token: merchantUser.token });
        // 无店铺时业务层会返回 403（"无权查看"），但不应是权限中间件的 PERMISSION_DENIED
        t.check('仅 market.access 可通过权限层进入经营账（业务层 404/403 均可，非 PERMISSION_DENIED）',
            !(r.data && r.data.code === 'PERMISSION_DENIED'), { status: r.status, code: r.data && r.data.code });
        r = await api('GET', '/api/market/merchant/stores', { token: admin1.token });
        t.check('Level 1 兼容：原有商家后台能力不减少（200）', r.status === 200, r.status);

        // 下单：经济资格前置 + 集市角色不替代经济资格
        const noEcon = await createUser({ level: 0, contribution: 0 });
        r = await api('POST', '/api/market/orders', { token: noEcon.token, body: { store_id: 1, items: [] } });
        t.check('无经济资格买家下单 → 403 ECONOMY_ACCESS_REQUIRED（market.access 不替代经济资格）',
            r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        const econBuyer = await createUser({ level: 0, contribution: 50 });
        await grant(econBuyer.id, await getRoleId('economy_member'));
        r = await api('POST', '/api/market/orders', { token: econBuyer.token, body: { store_id: 99999, items: [] } });
        t.check('经济成员下单通过经济闸门（非 403，业务层返回校验错误）', r.status !== 403, { status: r.status, code: r.data && r.data.code });

        // 权限数量核对：market 角色成员数正常
        const memberCount = await db.get(`SELECT COUNT(*) AS c FROM permission_role_members m JOIN permission_roles r ON r.id=m.role_id WHERE r.key IN ('market_reviewer','market_admin')`);
        t.check('集市角色成员已写入（>=2）', memberCount.c >= 2, memberCount.c);

        const ok = t.summary('集市 market.* 权限测试');
        await env.close();
        h.cleanup();
        process.exit(ok ? 0 : 1);
    } catch (e) {
        console.error('测试异常:', e);
        try { await env.close(); } catch (e2) { /* 忽略 */ }
        h.cleanup();
        process.exit(1);
    }
})();
