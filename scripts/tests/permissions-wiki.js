/**
 * 权限体系自动化测试（规范第二十条 18-19 项：Wiki 权限回归 + 前端权限刷新）
 *
 * 运行：node scripts/tests/permissions-wiki.js
 * 使用临时数据库（复制 data/guild.db 后迁移含 Wiki 表），不触碰生产库。
 *
 * 覆盖：
 * 18. Wiki 权限回归（Level 1 原有管理能力不减少；模块角色只授予本模块；核心删除权限仅 Level 2）
 * 19. 前端权限刷新（/api/auth/me 与登录返回 permissions/economy；角色变更后同一 token 下一次 /me 立即变化）
 */
const h = require('./permissions-harness');

(async () => {
    const t = h.createAssert();
    const env = await h.setup('wiki');
    const { api, db, createUser, getRoleId } = env;

    try {
        const superUser = await createUser({ level: 2 });
        const S = superUser.token;
        const admin1 = await createUser({ level: 1 });
        const wikiEditor = await createUser({ level: 0 });
        const wikiAdmin = await createUser({ level: 0 });
        const normalUser = await createUser({ level: 0 });

        const grant = (userId, roleId) => api('POST', `/api/permissions/roles/${roleId}/members`, { token: S, body: { user_ids: [userId] } });
        await grant(wikiEditor.id, await getRoleId('wiki_editor'));
        await grant(wikiAdmin.id, await getRoleId('wiki_admin'));

        /* ================= 18. Wiki 权限回归 ================= */
        t.section('18. Wiki 权限回归');

        // Level 1 原有管理能力
        const level1Checks = [
            ['GET', '/api/wiki/stats'],
            ['GET', '/api/wiki/admin/pages'],
            ['GET', '/api/wiki/admin/revisions'],
            ['GET', '/api/wiki/review-config'],
            ['GET', '/api/wiki/submissions/pending-count'],
            ['GET', '/api/wiki/submissions']
        ];
        for (const [method, url] of level1Checks) {
            const r = await api(method, url, { token: admin1.token });
            t.check(`Level 1 保留 Wiki 管理能力 ${method} ${url}`, r.status === 200, r.status);
        }
        let r = await api('POST', '/api/wiki', { token: admin1.token, body: { title: '权限回归页面A' + Date.now(), content: '正文内容 A' } });
        t.check('Level 1 可直接创建并发布 Wiki 页面（201 published）', r.status === 201 && r.data.page && r.data.page.status === 'published', r.data);
        const pageId = r.data.page && r.data.page.id;
        r = await api('PUT', `/api/wiki/${pageId}`, { token: admin1.token, body: { content: '正文内容 A 修改' } });
        t.check('Level 1 可直接编辑保存（200）', r.status === 200, r.data);
        r = await api('DELETE', `/api/wiki/${pageId}`, { token: admin1.token });
        t.check('页面彻底删除是核心权限，Level 1 无（403）', r.status === 403 && r.data.code === 'PERMISSION_DENIED', r.data);
        r = await api('POST', '/api/wiki/categories', { token: admin1.token, body: { name: '回归分类' + Date.now() } });
        t.check('Level 1 保留分类管理', r.status === 201, r.data);
        const categoryId = r.data.category && r.data.category.id;
        r = await api('DELETE', `/api/wiki/categories/${categoryId}`, { token: admin1.token });
        t.check('分类删除是核心权限，Level 1 无（403）', r.status === 403, r.data);
        r = await api('POST', `/api/wiki/${pageId}/archive`, { token: admin1.token });
        t.check('Level 1 可归档 Wiki 页面', r.status === 200, r.data);
        r = await api('POST', `/api/wiki/${pageId}/restore`, { token: admin1.token });
        t.check('Level 1 可恢复 Wiki 页面', r.status === 200, r.data);

        // 模块角色（Level 0）只在 Wiki 模块内生效
        r = await api('POST', '/api/wiki', { token: wikiEditor.token, body: { title: '编辑员页面' + Date.now(), content: '编辑员正文' } });
        t.check('Wiki 编辑员角色可直接创建页面（跳过审核，201）', r.status === 201 && r.data.page, r.data);
        r = await api('POST', '/api/wiki/submissions/1/reject', { token: wikiEditor.token, body: {} });
        t.check('Wiki 编辑员无审核权限（403）', r.status === 403, r.status);
        r = await api('POST', `/api/wiki/${pageId}/publish`, { token: wikiEditor.token });
        t.check('Wiki 编辑员无发布审核权限（403）', r.status === 403, r.status);
        r = await api('GET', '/api/admin/users', { token: wikiEditor.token });
        t.check('模块角色不能跨模块进入用户管理（403）', r.status === 403, r.status);

        // 普通用户仍走投稿审核通道（原有业务规则不破坏）
        r = await api('POST', '/api/wiki', { token: normalUser.token, body: { title: '普通用户投稿' + Date.now(), content: '投稿正文' } });
        t.check('普通用户创建页面仍走审核通道（202 pending）', r.status === 202 && r.data.pending === true, r.data);
        const submissionId = r.data.submission && r.data.submission.id;

        // Wiki 管理员角色：审核通过
        r = await api('GET', '/api/wiki/submissions', { token: wikiAdmin.token });
        t.check('Wiki 管理员角色可看待审队列', r.status === 200, r.status);
        r = await api('POST', `/api/wiki/submissions/${submissionId}/approve`, { token: wikiAdmin.token, body: { note: '回归通过' } });
        t.check('Wiki 管理员角色可审核通过投稿', r.status === 200, r.data);
        const subRow = await db.get('SELECT status FROM wiki_submissions WHERE id = ?', [submissionId]);
        t.check('投稿状态已更新为 approved', subRow && subRow.status === 'approved', subRow && subRow.status);

        // 核心删除权限仅 Level 2
        r = await api('DELETE', `/api/wiki/${pageId}`, { token: S });
        t.check('Level 2（核心权限）可彻底删除页面', r.status === 200, r.data);
        // 跨模块：Wiki 管理员角色不能授予/使用其它模块权限
        const wikiAdminRoleId = await getRoleId('wiki_admin');
        r = await api('PUT', `/api/permissions/roles/${wikiAdminRoleId}/permissions`, {
            token: S, body: { permissions: ['wiki.access', 'gis.submit'] }
        });
        t.check('系统角色权限配置同样受模块范围约束（SCOPE_VIOLATION）', r.status === 400 && r.data.code === 'SCOPE_VIOLATION', r.data);

        /* ================= 公告权限映射（管理模块回归） ================= */
        t.section('公告权限映射');
        r = await api('GET', '/api/admin/announcements', { token: admin1.token });
        t.check('Level 1 保留公告列表查看', r.status === 200, r.status);
        const ts = Date.now();
        r = await api('POST', '/api/admin/announcements', { token: admin1.token, body: { title: '回归公告' + ts, content: '公告内容', isActive: false } });
        t.check('Level 1 保留公告创建', r.status === 201, r.data);
        const annId = r.data.announcementId;
        r = await api('PUT', `/api/admin/announcements/${annId}`, { token: admin1.token, body: { title: '回归公告2', content: '公告内容', isActive: true } });
        t.check('Level 1 保留公告编辑与发布', r.status === 200, r.data);
        r = await api('DELETE', `/api/admin/announcements/${annId}`, { token: admin1.token });
        t.check('Level 1 保留公告删除', r.status === 200, r.data);
        r = await api('DELETE', `/api/admin/announcements/${annId}`, { token: normalUser.token });
        t.check('普通用户不能删除公告（403）', r.status === 403, r.status);

        /* ================= 19. 前端权限刷新 ================= */
        t.section('19. 前端权限刷新（/api/auth/me）');
        r = await api('POST', '/api/auth/login', { token: null, body: { username: wikiEditor.username, password: 'Test123456' } });
        t.check('登录返回 token 与实时权限字段', r.status === 200 && r.data.token && Array.isArray(r.data.user.permissions), r.data && r.data.user && r.data.user.permissions);
        t.check('登录返回 economy 字段', r.data.user.economy && typeof r.data.user.economy.access === 'boolean', r.data.user.economy);
        const editorToken = r.data.token;
        r = await api('GET', '/api/auth/me', { token: editorToken });
        t.check('登录后 /me 立即包含角色权限（wiki.access）', r.data.permissions.includes('wiki.access'), r.data.permissions);
        t.check('/me 返回角色列表（前端菜单门控依据）', Array.isArray(r.data.roles) && r.data.roles.length === 1 && r.data.roles[0].active === true, r.data.roles);

        // 角色禁用 → 同一 token 下一次 /me 立即变化（前端 refreshMe 可刷新）
        const wikiEditorRoleId = await getRoleId('wiki_editor');
        await api('POST', `/api/permissions/roles/${wikiEditorRoleId}/status`, { token: S, body: { status: 'DISABLED' } });
        r = await api('GET', '/api/auth/me', { token: editorToken });
        t.check('角色禁用后同一 token 的 /me 下一次请求立即无 wiki.access', !r.data.permissions.includes('wiki.access'), r.data.permissions);
        t.check('角色禁用后 /me 角色列表标记 active=false', r.data.roles[0].active === false, r.data.roles);
        await api('POST', `/api/permissions/roles/${wikiEditorRoleId}/status`, { token: S, body: { status: 'ACTIVE' } });
        r = await api('GET', '/api/auth/me', { token: editorToken });
        t.check('角色恢复后同一 token 下一次 /me 立即恢复权限', r.data.permissions.includes('wiki.access'), r.data.permissions);

        // 权限管理员（Level 0）前端应能进入权限中心
        const permAdmin = await createUser({ level: 0 });
        await grant(permAdmin.id, await getRoleId('permission_admin'));
        r = await api('GET', '/api/auth/me', { token: permAdmin.token });
        t.check('/me is_permission_admin=true（前端权限中心入口依据）', r.data.is_permission_admin === true, r.data.is_permission_admin);
        r = await api('GET', '/api/permissions/roles', { token: permAdmin.token });
        t.check('权限管理员可直接加载权限中心数据', r.status === 200, r.status);

        // 未登录 / 冻结账号的稳定错误码
        r = await api('GET', '/api/auth/me');
        t.check('未登录返回 401 UNAUTHORIZED', r.status === 401 && r.data.code === 'UNAUTHORIZED', r.data);
        const frozenUser = await createUser({ level: 0, frozen: 1 });
        r = await api('POST', '/api/auth/login', { body: { username: frozenUser.username, password: 'Test123456' } });
        t.check('冻结账号登录被拒且保留 frozen 标记（原有语义不破坏）', r.status === 403 && r.data.frozen === true, r.data);

        const ok = t.summary('Wiki 权限回归 + 前端权限刷新测试（18-19）');
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
