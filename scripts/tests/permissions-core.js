/**
 * 权限体系自动化测试（规范第二十条 1-11 项）
 *
 * 运行：node scripts/tests/permissions-core.js
 * 使用临时数据库（复制 data/guild.db 后迁移），不触碰生产库。
 *
 * 覆盖：
 *  1. Level 0/1/2 权限
 *  2. 多角色权限并集
 *  3. 模块角色跨模块授权阻断
 *  4. 禁用角色立即失效
 *  5. 归档角色立即失效
 *  6. 角色权限修改下一次请求生效
 *  7. 账号封禁权限失效
 *  8. 降级后保留角色
 *  9. 超级管理员保护
 * 10. 权限管理员边界
 * 11. 单用户直接授权不存在
 */
const h = require('./permissions-harness');

(async () => {
    const t = h.createAssert();
    const env = await h.setup('core');
    const { api, db, createUser, setLevel, setFrozen, getRoleId } = env;

    try {
        const superUser = await createUser({ level: 2, contribution: 500 });
        const admin1 = await createUser({ level: 1 });
        const admin2 = await createUser({ level: 1 });
        const member = await createUser({ level: 0, contribution: 0 });
        const S = superUser.token;

        /* ================= 1. Level 0/1/2 ================= */
        t.section('1. Level 0/1/2 权限');
        let r = await api('GET', '/api/admin/users', { token: S });
        t.check('Level 2 可访问用户管理', r.status === 200, r.status);
        r = await api('GET', '/api/permissions/roles', { token: S });
        t.check('Level 2 始终可进入权限中心', r.status === 200, r.status);

        r = await api('GET', '/api/admin/users', { token: admin1.token });
        t.check('Level 1 保留用户管理（admin.users.view 基础权限）', r.status === 200, r.status);
        r = await api('GET', '/api/contributions/all-logs', { token: admin1.token });
        t.check('Level 1 保留全局贡献点流水查看（旧能力不减少）', r.status === 200, r.status);
        r = await api('GET', '/api/permissions/roles', { token: admin1.token });
        t.check('Level 1 可进权限中心（只读查看角色列表 200，admin.permissions.view）', r.status === 200, r.status);
        r = await api('POST', '/api/permissions/roles', { token: admin1.token, body: { name: 'Level1越权角色' + Date.now(), scope: 'module', module: 'wiki', permissions: [] } });
        t.check('Level 1 只读权限中心、不能创建角色（403）', r.status === 403, r.data);
        r = await api('PUT', `/api/contributions/admin/${member.id}`, { token: admin1.token, body: { amount: 1, reason: 'test' } });
        t.check('Level 1 无 economy.contribution_points.manage（人工调整 403）', r.status === 403, r.status);

        r = await api('PUT', `/api/contributions/admin/${member.id}`, { token: S, body: { amount: 7, reason: '测试调整' } });
        t.check('Level 2 可人工调整贡献点', r.status === 200 && r.data.balanceAfter === 7, r.data);

        r = await api('GET', '/api/admin/users', { token: member.token });
        t.check('Level 0 无法访问用户管理', r.status === 403, r.status);
        r = await api('GET', '/api/permissions/roles', { token: member.token });
        t.check('Level 0 无法进入权限中心', r.status === 403, r.status);
        r = await api('GET', '/api/auth/me', { token: member.token });
        t.check('Level 0 /me 仅含基础权限 gis.submit（可提交 GIS 草稿，不能发布/审核）',
            r.status === 200 && Array.isArray(r.data.permissions)
            && r.data.permissions.length === 1 && r.data.permissions[0] === 'gis.submit',
            r.data && r.data.permissions);
        t.check('Level 0 不含 gis.object.review / gis.road.edit 等管理权限',
            !r.data.permissions.includes('gis.object.review') && !r.data.permissions.includes('gis.road.edit'),
            r.data.permissions);
        t.check('无经济资格 /me 不返回真实余额（contribution = null）', r.data.contribution === null, r.data.contribution);
        t.check('/me 返回 economy 字段且 access=false', r.data.economy && r.data.economy.access === false, r.data.economy);

        const econMember = await createUser({ level: 0, contribution: 100 });
        await api('POST', `/api/permissions/roles/${await getRoleId('economy_member')}/members`, {
            token: S, body: { user_ids: [econMember.id] }
        });
        r = await api('GET', '/api/auth/me', { token: econMember.token });
        t.check('经济成员角色：/me 余额可见', r.status === 200 && r.data.contribution === 100, r.data.contribution);
        t.check('经济成员角色：economy.access=true', r.data.economy.access === true, r.data.economy);

        /* ================= 2. 多角色并集 ================= */
        t.section('2. 多角色权限并集');
        const wikiEditorId = await getRoleId('wiki_editor');
        const gisEditorId = await getRoleId('gis_editor');
        const multi = await createUser({ level: 0 });
        await api('POST', `/api/permissions/roles/${wikiEditorId}/members`, { token: S, body: { user_ids: [multi.id] } });
        await api('POST', `/api/permissions/roles/${gisEditorId}/members`, { token: S, body: { user_ids: [multi.id] } });
        r = await api('GET', '/api/permissions/me', { token: multi.token });
        const pk = (r.data.permissions || []);
        t.check('多角色并集包含 wiki.access', pk.includes('wiki.access'), pk);
        t.check('多角色并集包含 gis.submit', pk.includes('gis.submit'), pk);
        t.check('角色不越权带出未授予的 wiki.page.review', !pk.includes('wiki.page.review'), pk);
        r = await api('GET', `/api/permissions/users/${multi.id}/permissions`, { token: S });
        t.check('权限溯源可列出每项权限来源', r.status === 200 &&
            r.data.trace.effectivePermissions.some(p => p.key === 'wiki.access' && p.sources.some(s => s.type === 'role')), r.status);

        /* ================= 3. 模块角色跨模块授权阻断 ================= */
        t.section('3. 模块角色跨模块授权阻断');
        r = await api('POST', '/api/permissions/roles', { token: S, body: { name: '越权测试角色' + Date.now(), scope: 'module', module: 'wiki', permissions: ['gis.submit'] } });
        t.check('模块角色不能授予其它模块权限（SCOPE_VIOLATION）', r.status === 400 && r.data.code === 'SCOPE_VIOLATION', r.data);

        /* ================= 4/5. 禁用 / 归档角色立即失效 ================= */
        t.section('4/5. 禁用、归档角色立即失效');
        r = await api('GET', '/api/wiki/admin/pages', { token: multi.token });
        t.check('启用状态下 wiki.access 生效（200）', r.status === 200, r.status);
        r = await api('POST', `/api/permissions/roles/${wikiEditorId}/status`, { token: S, body: { status: 'DISABLED' } });
        t.check('禁用 Wiki 编辑员角色', r.status === 200 && r.data.role.status === 'DISABLED', r.data.code);
        r = await api('GET', '/api/wiki/admin/pages', { token: multi.token });
        t.check('角色禁用后下一次请求立即失效（403）', r.status === 403, r.status);
        r = await api('POST', `/api/permissions/roles/${wikiEditorId}/status`, { token: S, body: { status: 'ACTIVE' } });
        r = await api('GET', '/api/wiki/admin/pages', { token: multi.token });
        t.check('恢复 ACTIVE 后下一次请求立即恢复（200）', r.status === 200, r.status);
        await api('POST', `/api/permissions/roles/${wikiEditorId}/status`, { token: S, body: { status: 'ARCHIVED' } });
        r = await api('GET', '/api/wiki/admin/pages', { token: multi.token });
        t.check('角色归档后立即失效（403）', r.status === 403, r.status);
        r = await api('GET', `/api/permissions/users/${multi.id}/permissions`, { token: S });
        t.check('溯源解释失效原因 role_archived', JSON.stringify(r.data.trace.reasons || []).includes('role_archived'), r.data.trace && r.data.trace.reasons);
        await api('POST', `/api/permissions/roles/${wikiEditorId}/status`, { token: S, body: { status: 'ACTIVE' } });

        /* ================= 6. 角色权限修改下一次请求生效 ================= */
        t.section('6. 角色权限修改下一次请求生效');
        const tplPerms = ['wiki.access', 'wiki.page.create', 'wiki.page.edit'];
        r = await api('PUT', `/api/permissions/roles/${wikiEditorId}/permissions`, {
            token: S, body: { permissions: ['wiki.page.create', 'wiki.page.edit'] }
        });
        t.check('修改角色权限（移除 wiki.access）', r.status === 200, r.data);
        r = await api('GET', '/api/wiki/admin/pages', { token: multi.token });
        t.check('权限移除后下一次请求立即失效（403）', r.status === 403, r.status);
        await api('PUT', `/api/permissions/roles/${wikiEditorId}/permissions`, { token: S, body: { permissions: tplPerms } });
        r = await api('GET', '/api/wiki/admin/pages', { token: multi.token });
        t.check('权限恢复后下一次请求立即生效（200）', r.status === 200, r.status);

        /* ================= 7. 账号封禁 ================= */
        t.section('7. 账号封禁权限失效');
        await setFrozen(admin1.id, 1);
        r = await api('GET', '/api/admin/users', { token: admin1.token });
        t.check('封禁后管理权限立即失效（403 ACCOUNT_FROZEN）', r.status === 403 && r.data.code === 'ACCOUNT_FROZEN', r.data);
        await setFrozen(multi.id, 1);
        r = await api('GET', '/api/wiki/admin/pages', { token: multi.token });
        t.check('封禁后角色权限立即失效', r.status === 403 && r.data.code === 'ACCOUNT_FROZEN', r.data);
        r = await api('GET', '/api/permissions/me', { token: multi.token });
        t.check('封禁后 /me 也不可访问', r.status === 403, r.status);
        const roleRows = await db.all('SELECT * FROM permission_role_members WHERE user_id = ?', [multi.id]);
        t.check('封禁不删除角色成员关系', roleRows.length >= 1, roleRows.length);
        await setFrozen(multi.id, 0);
        r = await api('GET', '/api/wiki/admin/pages', { token: multi.token });
        t.check('解封后重新计算权限（200）', r.status === 200, r.status);
        await setFrozen(admin1.id, 0);

        /* ================= 8. 降级后保留角色 ================= */
        t.section('8. 降级后保留角色');
        const demote = await createUser({ level: 1 });
        await api('POST', `/api/permissions/roles/${wikiEditorId}/members`, { token: S, body: { user_ids: [demote.id] } });
        r = await api('GET', '/api/admin/users', { token: demote.token });
        t.check('Level 1 基础管理员权限生效', r.status === 200, r.status);
        r = await api('PUT', `/api/admin/users/${demote.id}/level`, { token: S, body: { level: 0 } });
        t.check('超级管理员可将 Level 1 降为 Level 0', r.status === 200, r.data);
        r = await api('GET', '/api/admin/users', { token: demote.token });
        t.check('降级后 Level 基础管理权限失效', r.status === 403, r.status);
        r = await api('GET', '/api/wiki/admin/pages', { token: demote.token });
        t.check('降级后角色权限继续生效', r.status === 200, r.status);
        const demoteRoles = await db.all('SELECT * FROM permission_role_members WHERE user_id = ?', [demote.id]);
        t.check('降级不删除角色成员关系', demoteRoles.length === 1, demoteRoles.length);
        await api('PUT', `/api/admin/users/${demote.id}/level`, { token: S, body: { level: 1 } });
        r = await api('GET', '/api/admin/users', { token: demote.token });
        t.check('升级回 Level 1 后重新计算（200）', r.status === 200, r.status);

        /* ================= 9. 超级管理员保护 ================= */
        t.section('9. 超级管理员保护');
        const permAdmin = await createUser({ level: 0 });
        await api('POST', `/api/permissions/roles/${await getRoleId('permission_admin')}/members`, { token: S, body: { user_ids: [permAdmin.id] } });
        r = await api('GET', '/api/permissions/roles', { token: permAdmin.token });
        t.check('权限管理员（Level 0）可进入权限中心', r.status === 200, r.status);
        r = await api('PUT', `/api/permissions/users/${superUser.id}/roles`, { token: permAdmin.token, body: { role_ids: [] } });
        t.check('权限管理员不能修改 Level 2 用户的角色', r.status === 403 && r.data.code === 'SUPER_ADMIN_PROTECTED', r.data);
        r = await api('POST', `/api/permissions/roles/${await getRoleId('permission_admin')}/members`, { token: permAdmin.token, body: { user_ids: [member.id] } });
        t.check('权限管理员不能分配含核心权限的角色（不能造第二个权限管理员）',
            r.status === 200 && r.data.failCount === 1 && r.data.results[0].code === 'PROTECTED_PERMISSION', r.data);
        r = await api('PUT', `/api/admin/users/${superUser.id}/level`, { token: permAdmin.token, body: { level: 0 } });
        t.check('权限管理员不能调整等级（无 admin.users.level）', r.status === 403, r.status);
        // 最后一个超级管理员不可降级
        await db.run('UPDATE users SET level = 0 WHERE level >= 2 AND id != ?', [superUser.id]);
        r = await api('PUT', `/api/admin/users/${superUser.id}/level`, { token: S, body: { level: 0 } });
        t.check('不能降级最后一个超级管理员', r.status === 400 && r.data.code === 'LAST_SUPER_ADMIN', r.data);
        await db.run('UPDATE users SET level = 2 WHERE id = ?', [superUser.id]);

        /* ================= 10. 权限管理员边界 ================= */
        t.section('10. 权限管理员边界');
        r = await api('PUT', `/api/permissions/roles/${wikiEditorId}/permissions`, { token: permAdmin.token, body: { permissions: tplPerms } });
        t.check('权限管理员不能修改系统角色权限', r.status === 403 && r.data.code === 'SUPER_ADMIN_PROTECTED', r.data);
        r = await api('POST', `/api/permissions/roles/${wikiEditorId}/status`, { token: permAdmin.token, body: { status: 'DISABLED' } });
        t.check('权限管理员不能禁用系统角色', r.status === 403, r.data);
        r = await api('PUT', `/api/permissions/users/${permAdmin.id}/roles`, { token: permAdmin.token, body: { role_ids: [] } });
        t.check('权限管理员不能修改自己的角色（防自我提权）', r.status === 403 && r.data.code === 'SELF_ESCALATION', r.data);
        r = await api('POST', '/api/permissions/roles', { token: permAdmin.token, body: { name: '自提权角色' + Date.now(), scope: 'global', permissions: ['admin.users.view'] } });
        t.check('权限管理员不能授予自己不具备的管理后台权限', r.status === 403 && r.data.code === 'SELF_ESCALATION', r.data);
        r = await api('POST', '/api/permissions/roles', { token: permAdmin.token, body: { name: '自定义Wiki角色' + Date.now(), scope: 'module', module: 'wiki', permissions: ['wiki.page.create'] } });
        t.check('权限管理员可创建自定义模块角色', r.status === 201, r.data);
        const customRoleId = r.data.role && r.data.role.id;
        r = await api('POST', `/api/permissions/roles/${customRoleId}/members`, { token: permAdmin.token, body: { user_ids: [member.id] } });
        t.check('权限管理员可分配自定义角色成员', r.status === 200 && r.data.successCount === 1, r.data);
        r = await api('DELETE', `/api/permissions/roles/${customRoleId}/members/${member.id}`, { token: permAdmin.token });
        t.check('权限管理员可移除角色成员', r.status === 200 && r.data.successCount === 1, r.data);
        r = await api('POST', `/api/permissions/roles/${customRoleId}/status`, { token: permAdmin.token, body: { status: 'DISABLED' } });
        t.check('权限管理员可禁用自定义角色', r.status === 200, r.data);
        r = await api('PUT', `/api/admin/users/${admin2.id}/level`, { token: permAdmin.token, body: { level: 2 } });
        t.check('权限管理员不能提升等级/造超级管理员', r.status === 403, r.status);

        /* ================= 11. 单用户直接授权不存在 ================= */
        t.section('11. 单用户直接授权不存在');
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        const names = tables.map(x => x.name);
        const userLevelTables = names.filter(n => /user_?permission|permission_?user|user_?allow|user_?deny|user_?grant|direct_?grant/i.test(n));
        t.check('不存在任何单用户直接授权/拒绝表', userLevelTables.length === 0, userLevelTables);
        const rolePermCols = await db.all('PRAGMA table_info(permission_role_permissions)');
        t.check('角色权限表只有 role_id + permission_key，无 user_id', !rolePermCols.some(c => c.name === 'user_id'), rolePermCols.map(c => c.name));
        r = await api('PUT', `/api/permissions/users/${member.id}/permissions`, { token: S, body: { permissions: ['admin.users.view'] } });
        t.check('不存在“给用户直接加权限”的接口（404）', r.status === 404, r.status);
        const auditCount = await db.get('SELECT COUNT(*) AS c FROM permission_audit_logs');
        t.check('权限管理动作已写审计日志', auditCount.c > 0, auditCount.c);
        r = await api('GET', '/api/permissions/audit', { token: S });
        t.check('审计日志可查询且包含前后差异', r.status === 200 && r.data.items.length > 0 &&
            r.data.items.some(i => i.before !== undefined), r.status);

        const ok = t.summary('权限核心测试（1-11）');
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
