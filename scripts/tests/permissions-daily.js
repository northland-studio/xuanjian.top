/**
 * 「外会官号」角色 + 发布日报权限测试
 *
 * 运行：node scripts/tests/permissions-daily.js
 * 覆盖：
 *  1. 权限定义 content.daily.publish 已注册（module=content）
 *  2. 普通 Level 0 成员发布日报被拒（403）
 *  3. 创建「外会官号」模块角色（content 模块，权限仅 content.daily.publish）
 *  4. 授予该角色后 Level 0 成员可发布日报（201），且 Level 仍为 0
 *  5. 该角色不能发布决策（decision 仍需 Level>=1）
 *  6. 该角色不影响普通贴吧发帖
 *  7. 移除角色后下一次请求立即失去日报权限（权限实时生效）
 *  8. Level 1 管理员不依赖该角色也能发日报
 *  9. 权限中心 registry / 角色列表可见
 */
const h = require('./permissions-harness');

(async () => {
    const t = h.createAssert();
    const env = await h.setup('daily');
    const { api, db, createUser } = env;

    try {
        const superUser = await createUser({ level: 2 });
        const admin1 = await createUser({ level: 1 });
        const member = await createUser({ level: 0 });
        const S = superUser.token;

        // 发帖要求绑定 QQ(openid) 与邮箱
        for (const u of [superUser, admin1, member]) {
            await db.run('UPDATE users SET openid = ?, email = COALESCE(email, ?) WHERE id = ?', ['test-openid-' + u.id, 't' + u.id + '@example.com', u.id]);
        }

        /* ============ 1. 权限定义 ============ */
        t.section('1. 权限定义 content.daily.publish');
        const def = await db.get('SELECT key, module, resource, action, status FROM permission_definitions WHERE key = ?', ['content.daily.publish']);
        t.check('权限定义已同步到数据库', !!def, def);
        t.check('module=content / resource=daily / action=publish', def && def.module === 'content' && def.resource === 'daily' && def.action === 'publish', def);
        t.check('状态 ACTIVE', def && def.status === 'ACTIVE', def && def.status);

        /* ============ 2. 普通成员不能发日报 ============ */
        t.section('2. 普通 Level 0 成员不能发日报');
        let r = await api('POST', '/api/posts', { token: member.token, body: { title: '测试日报-未授权', content: '正文', type: 'daily' } });
        t.check('Level 0 发日报 403', r.status === 403, r.status);

        /* ============ 3. 创建「外会官号」角色 ============ */
        t.section('3. 创建外会官号角色');
        r = await api('POST', '/api/permissions/roles', {
            token: S,
            body: {
                name: '外会官号',
                scope: 'module',
                module: 'content',
                description: '外会基础成员 + 发布公会日报（仅额外授予日报发布权限）',
                permissions: ['content.daily.publish']
            }
        });
        t.check('创建角色 201', r.status === 201, { status: r.status, body: r.data });
        const role = r.data && r.data.role;
        t.check('角色名=外会官号、key 非空', !!role && role.name === '外会官号' && typeof role.key === 'string' && role.key.length > 0, role && { key: role.key, name: role.name, scope: role.scope, module: role.module });
        t.check('角色 scope=module / module=content', !!role && role.scope === 'module' && role.module === 'content', role && { scope: role.scope, module: role.module });
        const rolePermKeys = (role && Array.isArray(role.permissions) ? role.permissions : []).map((x) => (typeof x === 'string' ? x : x && x.key));
        t.check('角色权限仅有 content.daily.publish', rolePermKeys.length === 1 && rolePermKeys[0] === 'content.daily.publish', rolePermKeys);

        /* ============ 4. 授予角色后可发日报 ============ */
        t.section('4. 授予外会官号后可发布日报');
        r = await api('POST', `/api/permissions/roles/${role.id}/members`, { token: S, body: { userIds: [member.id] } });
        t.check('授予角色成功', r.status === 200 && r.data && r.data.successCount === 1, { status: r.status, body: r.data });

        r = await api('POST', '/api/posts', { token: member.token, body: { title: '测试日报-外会官号', content: '外会官号发布日报测试', type: 'daily' } });
        t.check('有角色后 Level 0 发日报 201', r.status === 201, { status: r.status, body: r.data });
        const memberAfter = await db.get('SELECT level FROM users WHERE id = ?', [member.id]);
        t.check('Level 仍为 0（角色不提升 Level）', memberAfter.level === 0, memberAfter.level);

        /* ============ 5. 不能发决策 ============ */
        t.section('5. 外会官号不能发布决策');
        r = await api('POST', '/api/posts', { token: member.token, body: { title: '测试决策-外会官号', content: '正文', type: 'decision' } });
        t.check('发决策仍 403（decision 要求 Level>=1）', r.status === 403, r.status);

        /* ============ 6. 普通贴吧发帖不受影响 ============ */
        t.section('6. 普通贴吧发帖不受影响');
        r = await api('POST', '/api/posts', { token: member.token, body: { title: '测试贴吧-外会官号', content: '正文', type: 'forum' } });
        t.check('forum 类型 201', r.status === 201, r.status);

        /* ============ 7. 移除角色后实时失效 ============ */
        t.section('7. 移除角色后立即失效');
        r = await api('DELETE', `/api/permissions/roles/${role.id}/members/${member.id}`, { token: S });
        t.check('移除角色成员成功', r.status === 200, r.status);
        r = await api('POST', '/api/posts', { token: member.token, body: { title: '测试日报-移除后', content: '正文', type: 'daily' } });
        t.check('移除后发日报又 403', r.status === 403, r.status);

        /* ============ 8. Level 1 管理员仍可直接发日报 ============ */
        t.section('8. Level 1 管理员不受影响');
        r = await api('POST', '/api/posts', { token: admin1.token, body: { title: '测试日报-管理员', content: '正文', type: 'daily' } });
        t.check('Level 1 发日报 201', r.status === 201, r.status);

        /* ============ 9. 权限中心可见 ============ */
        t.section('9. 权限中心可见');
        r = await api('GET', '/api/permissions/registry', { token: S });
        const reg = (r.data && (r.data.registry || r.data)) || {};
        const defs = Array.isArray(reg.permissions) ? reg.permissions : [];
        t.check('registry 包含 content.daily.publish', r.status === 200 && defs.some((d) => (d.key || d.permission_key) === 'content.daily.publish'), { status: r.status, count: defs.length });
        r = await api('GET', '/api/permissions/roles?search=' + encodeURIComponent('外会官号'), { token: S });
        const roles = (r.data && (r.data.roles || r.data.items || [])) || [];
        t.check('角色列表可搜到外会官号', r.status === 200 && roles.some((x) => x.name === '外会官号'), { status: r.status, count: roles.length });

        const ok = t.summary('外会官号日报角色测试（1-9）');
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
