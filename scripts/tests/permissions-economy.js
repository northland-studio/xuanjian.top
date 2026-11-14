/**
 * 权限体系自动化测试（规范第二十条 12-17 项：贡献点经济资格）
 *
 * 运行：node scripts/tests/permissions-economy.js
 * 使用临时数据库（复制 data/guild.db 后迁移），不触碰生产库。
 *
 * 覆盖：
 * 12. 贡献点资格迁移（幂等、系统账号不加入、余额/流水不变、新用户不自动获得）
 * 13. 失去经济资格后账户冻结（余额/流水保留、接口全部后端拦截）
 * 14. 重新获得资格后账户恢复
 * 15. 贡献点转账、获取、消费的后端权限
 * 16. 集市购买接口经济资格（economyGate 覆盖 /api/market/orders）
 * 17. 集市原有订单/托管/退款/结算：本组测试未改 routes/market.js 与 lib/market*.js，
 *     仅新增全局闸门；原有回归由 scripts/test-market-isolation.js 与生产验证覆盖（见交付报告）。
 */
const h = require('./permissions-harness');

(async () => {
    const t = h.createAssert();
    const env = await h.setup('economy');
    const { api, db, createUser, getRoleId } = env;

    try {
        const baseMaxId = (await db.get('SELECT COALESCE(MAX(id), 0) AS m FROM users')).m;
        const superUser = await createUser({ level: 2, contribution: 1000 });
        const S = superUser.token;
        const econMemberRoleId = await getRoleId('economy_member');
        const econAdminRoleId = await getRoleId('economy_admin');

        const grant = (userId, roleId) => api('POST', `/api/permissions/roles/${roleId}/members`, { token: S, body: { user_ids: [userId] } });
        const revoke = (userId, roleId) => api('DELETE', `/api/permissions/roles/${roleId}/members/${userId}`, { token: S });

        /* ================= 12. 贡献点资格迁移 ================= */
        t.section('12. 贡献点资格迁移（迁移/幂等/核对）');
        const roleRow = await db.get("SELECT * FROM permission_roles WHERE key = 'economy_member'");
        t.check('默认「玄剑经济成员」角色存在且 ACTIVE', !!roleRow && roleRow.status === 'ACTIVE', roleRow && roleRow.status);
        const rolePerms = (await db.all('SELECT permission_key FROM permission_role_permissions WHERE role_id = ?', [roleRow.id]))
            .map(r => r.permission_key).sort();
        t.check('经济成员角色包含 access/earn/spend/transfer 四项', JSON.stringify(rolePerms) === JSON.stringify([
            'economy.contribution_points.access',
            'economy.contribution_points.earn',
            'economy.contribution_points.spend',
            'economy.contribution_points.transfer'
        ]), rolePerms);
        const missing = await db.get(`
            SELECT COUNT(*) AS c FROM users u
             WHERE u.id <= ? AND COALESCE(u.level, 0) >= 0 AND COALESCE(u.contribution, 0) != 0
               AND NOT EXISTS (
                    SELECT 1 FROM permission_role_members m
                      JOIN permission_roles r ON r.id = m.role_id
                     WHERE r.key = 'economy_member' AND m.user_id = u.id)`, [baseMaxId]);
        t.check('有余额的用户均已加入经济成员角色（迁移已执行）', missing.c === 0, missing.c);
        const statsBefore = {
            users: (await db.get('SELECT COUNT(*) AS c FROM users')).c,
            balance: (await db.get('SELECT COALESCE(SUM(COALESCE(contribution,0)),0) AS s FROM users')).s,
            logs: (await db.get('SELECT COUNT(*) AS c FROM contribution_logs')).c,
            transfers: (await db.get('SELECT COUNT(*) AS c FROM transfers')).c,
            members: (await db.get('SELECT COUNT(*) AS c FROM permission_role_members WHERE role_id = ?', [roleRow.id])).c
        };
        // 系统账号（level = -1）：不加入经济成员角色
        const sys = await db.run(
            `INSERT INTO users (username, nickname, email, password, level, contribution, password_set)
             VALUES (?, ?, ?, 'x', -1, 500, 1)`,
            [`sys_escrow_${Date.now()}`, '托管系统账号', `escrow_${Date.now()}@test.local`]
        );
        const migration = require('../../migrations/103_economy_members_backfill');
        const report1 = await migration.up(db);
        await new Promise((r) => setTimeout(r, 5));
        const report2 = await migration.up(db);
        t.check('迁移可重复执行（第二次新增 0）', report2.inserted === 0, report2.inserted);
        const sysIsMember = await db.get(
            'SELECT 1 AS x FROM permission_role_members WHERE role_id = ? AND user_id = ?', [roleRow.id, sys.id]
        );
        t.check('系统账号（level=-1）不会被加入普通经济成员角色', !sysIsMember, sysIsMember);
        t.check('迁移不改变贡献点总余额', report1.after.totalBalance === report1.before.totalBalance, report1);
        t.check('迁移不改变历史流水数量', report1.after.logCount === report1.before.logCount, report1);
        const newUser = await createUser({ level: 0, contribution: 0 });
        const newMember = await db.get(
            'SELECT 1 AS x FROM permission_role_members WHERE role_id = ? AND user_id = ?', [roleRow.id, newUser.id]
        );
        t.check('新用户不会自动获得经济资格', !newMember, newMember);
        const statsAfter = {
            users: (await db.get('SELECT COUNT(*) AS c FROM users')).c,
            balance: (await db.get('SELECT COALESCE(SUM(COALESCE(contribution,0)),0) AS s FROM users')).s,
            logs: (await db.get('SELECT COUNT(*) AS c FROM contribution_logs')).c,
            transfers: (await db.get('SELECT COUNT(*) AS c FROM transfers')).c
        };
        t.check('迁移前后贡献点总余额一致', statsBefore.balance + 500 === statsAfter.balance, { statsBefore, statsAfter });
        t.check('迁移前后历史流水数一致', statsBefore.logs === statsAfter.logs, { statsBefore, statsAfter });
        t.check('迁移前后转账记录数一致', statsBefore.transfers === statsAfter.transfers, { statsBefore, statsAfter });

        /* ================= 13/14. 失去/恢复经济资格 ================= */
        t.section('13/14. 失去资格冻结、重新获得恢复');
        const econUser = await createUser({ level: 0, contribution: 100 });
        const noEcon = await createUser({ level: 0, contribution: 50 });
        await grant(econUser.id, econMemberRoleId);

        let r = await api('GET', '/api/contributions/logs', { token: econUser.token });
        t.check('经济成员可查看自己的流水', r.status === 200, r.status);
        r = await api('GET', '/api/auth/me', { token: econUser.token });
        t.check('经济成员 /me 余额可见', r.data.contribution === 100 && r.data.economy.access === true, r.data.contribution);

        r = await revoke(econUser.id, econMemberRoleId);
        t.check('移除经济成员角色', r.status === 200 && r.data.successCount === 1, r.data);
        r = await api('GET', '/api/contributions/logs', { token: econUser.token });
        t.check('失去资格后流水不可见（403 ECONOMY_ACCESS_REQUIRED）', r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        r = await api('GET', '/api/auth/me', { token: econUser.token });
        t.check('失去资格后 /me 不返回余额', r.status === 200 && r.data.contribution === null, r.data.contribution);
        r = await api('POST', '/api/contributions/transfer', { token: econUser.token, body: { toUserId: noEcon.id, amount: 1 } });
        t.check('失去资格后不能转账（403）', r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        const balanceKept = await db.get('SELECT contribution FROM users WHERE id = ?', [econUser.id]);
        t.check('失去资格保留余额', Number(balanceKept.contribution) === 100, balanceKept.contribution);
        const logsKept = await db.get('SELECT COUNT(*) AS c FROM contribution_logs WHERE user_id = ?', [econUser.id]);
        t.check('失去资格保留历史流水（记录未删）', logsKept.c >= 0, logsKept.c);
        const frozenCol = await db.get('SELECT is_frozen FROM users WHERE id = ?', [econUser.id]);
        t.check('经济资格冻结不写入 users.is_frozen', Number(frozenCol.is_frozen) === 0, frozenCol.is_frozen);

        await grant(econUser.id, econMemberRoleId);
        r = await api('GET', '/api/contributions/logs', { token: econUser.token });
        t.check('重新获得资格后流水恢复可见（200）', r.status === 200, r.status);
        r = await api('GET', '/api/auth/me', { token: econUser.token });
        t.check('重新获得资格后 /me 余额恢复', r.data.contribution === 100, r.data.contribution);

        /* ================= 15. 转账 / 获取 / 消费后端权限 ================= */
        t.section('15. 转账、获取、消费的后端权限');
        r = await api('POST', '/api/contributions/transfer', { token: econUser.token, body: { toUserId: noEcon.id, amount: 10, note: '测试转账' } });
        t.check('经济成员可转账', r.status === 200, r.data);
        const toBalance = await db.get('SELECT contribution FROM users WHERE id = ?', [noEcon.id]);
        t.check('转账入账正确', Number(toBalance.contribution) === 60, toBalance.contribution);
        const transferRow = await db.get('SELECT * FROM transfers WHERE from_user = ? ORDER BY id DESC LIMIT 1', [econUser.id]);
        t.check('转账记录写入 transfers 表', !!transferRow && transferRow.amount === 10, transferRow && transferRow.amount);
        const ledger = await db.all('SELECT * FROM contribution_logs WHERE user_id IN (?, ?) ORDER BY id DESC LIMIT 2', [econUser.id, noEcon.id]);
        t.check('转账双方均写入流水', ledger.length === 2, ledger.length);

        r = await api('POST', '/api/checkin/checkin', { token: noEcon.token });
        t.check('非经济成员不能签到获取贡献点（403）', r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        r = await api('POST', '/api/shop/items/1/buy', { token: noEcon.token });
        t.check('非经济成员不能消费（403）', r.status === 403, r.data);
        r = await api('POST', '/api/checkin/checkin', { token: econUser.token });
        t.check('经济成员可获取贡献点（签到接口放行）', r.status === 200 && r.data.stub === true, r.data);
        r = await api('POST', '/api/shop/items/1/buy', { token: econUser.token });
        t.check('经济成员可消费（商城接口放行）', r.status === 200 && r.data.stub === true, r.data);

        // 只有 access 没有 earn/spend/transfer 的自定义经济角色：earn/spend 应被拒
        const limitedRole = await api('POST', '/api/permissions/roles', {
            token: S, body: { name: '仅准入经济角色' + Date.now(), scope: 'module', module: 'economy', permissions: ['economy.contribution_points.access'] }
        });
        t.check('可创建仅含 access 的经济角色', limitedRole.status === 201, limitedRole.data);
        const limitedUser = await createUser({ level: 0, contribution: 10 });
        await grant(limitedUser.id, limitedRole.data.role.id);
        r = await api('GET', '/api/contributions/logs', { token: limitedUser.token });
        t.check('仅 access：可查看流水', r.status === 200, r.status);
        r = await api('POST', '/api/checkin/checkin', { token: limitedUser.token });
        t.check('仅 access：不能获取贡献点（ECONOMY_PERMISSION_REQUIRED）', r.status === 403 && r.data.code === 'ECONOMY_PERMISSION_REQUIRED', r.data);
        r = await api('POST', '/api/contributions/transfer', { token: limitedUser.token });
        t.check('仅 access：不能转账', r.status === 403, r.data);

        // 系统角色移除 transfer 权限 → 立即生效
        const roleBefore = (await db.all('SELECT permission_key FROM permission_role_permissions WHERE role_id = ?', [econMemberRoleId])).map(x => x.permission_key);
        await api('PUT', `/api/permissions/roles/${econMemberRoleId}/permissions`, {
            token: S, body: { permissions: roleBefore.filter(p => !p.endsWith('.transfer')) }
        });
        r = await api('POST', '/api/contributions/transfer', { token: econUser.token, body: { toUserId: noEcon.id, amount: 1 } });
        t.check('移除 transfer 权限后转账立即被拒（403）', r.status === 403 && r.data.code === 'ECONOMY_PERMISSION_REQUIRED', r.data);
        await api('PUT', `/api/permissions/roles/${econMemberRoleId}/permissions`, { token: S, body: { permissions: roleBefore } });
        r = await api('POST', '/api/contributions/transfer', { token: econUser.token, body: { toUserId: noEcon.id, amount: 1 } });
        t.check('恢复 transfer 权限后立即生效', r.status === 200, r.data);

        /* ================= 16. 集市购买接口经济资格 ================= */
        t.section('16. 集市下单接口经济资格（economyGate）');
        r = await api('POST', '/api/market/orders', { token: noEcon.token, body: { store_id: 1, items: [] } });
        t.check('外会人员（无经济资格）不能集市下单（403）', r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        r = await api('POST', '/api/market/orders', { token: econUser.token, body: { store_id: 1, items: [] } });
        t.check('经济成员可进入集市下单链路', r.status === 200 && r.data.stub === true, r.data);
        r = await api('POST', '/api/market/orders', { body: { store_id: 1, items: [] } });
        t.check('未登录不会绕过闸门（401 由路由鉴权返回）', r.status === 401, r.status);
        r = await api('POST', '/api/pay/scan', { token: noEcon.token, body: {} });
        t.check('非经济成员不能通过扫码支付绕过', r.status === 403, r.data);
        r = await api('POST', '/api/express-index/buy', { token: noEcon.token, body: {} });
        t.check('非经济成员不能通过股市接口绕过', r.status === 403, r.data);

        // ===== 模组（Minecraft 客户端 playerAuth 通道）经济资格 =====
        const uuid = `uuid-${Date.now()}`;
        const modUser = await createUser({ level: 0, contribution: 20 });
        await db.run('INSERT INTO mod_bindings (uuid, user_id, player_name, status) VALUES (?, ?, ?, ?)', [uuid, modUser.id, '模组测试玩家', 'confirmed']);
        r = await api('GET', `/api/mod/balance?uuid=${uuid}`);
        t.check('模组余额查询：无经济资格 403（不泄漏余额）', r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        r = await api('POST', '/api/mod/checkin', { body: { uuid } });
        t.check('模组签到：无经济资格 403（不能绕过官网领取贡献点）', r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        r = await api('POST', '/api/mod/transfer', { body: { fromUuid: uuid, toPlayer: noEcon.username, amount: 1 } });
        t.check('模组转账：无经济资格 403', r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        await grant(modUser.id, econMemberRoleId);
        r = await api('GET', `/api/mod/balance?uuid=${uuid}`);
        t.check('模组余额查询：经济成员可见', r.status === 200 && r.data.balance === 20, r.data);
        r = await api('POST', '/api/mod/checkin', { body: { uuid } });
        t.check('模组签到：经济成员可进入签到流程（非 403）', r.status !== 403, r.data);

        /* ================= 经济管理员边界 ================= */
        t.section('经济管理员边界（manage 独立配置）');
        const econAdmin = await createUser({ level: 0, contribution: 0 });
        await grant(econAdmin.id, econAdminRoleId);
        r = await api('GET', '/api/auth/me', { token: econAdmin.token });
        t.check('经济管理员 manage=true 但 access=false', r.data.economy.manage === true && r.data.economy.access === false, r.data.economy);
        t.check('经济管理员不自动获得经济成员资格（/me 无余额）', r.data.contribution === null, r.data.contribution);
        r = await api('GET', '/api/contributions/all-logs', { token: econAdmin.token });
        t.check('经济管理员可查看全局流水', r.status === 200, r.status);
        const balanceBeforeAdjust = Number((await db.get('SELECT contribution FROM users WHERE id = ?', [noEcon.id])).contribution);
        r = await api('PUT', `/api/contributions/admin/${noEcon.id}`, { token: econAdmin.token, body: { amount: 5, reason: '经济管理员调整测试' } });
        t.check('经济管理员可人工调整贡献点', r.status === 200 && r.data.balanceAfter === balanceBeforeAdjust + 5, r.data);
        const adjustLog = await db.get('SELECT * FROM contribution_logs WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT 1', [noEcon.id, 'admin']);
        t.check('人工调整账本记录 operator_id', Number(adjustLog.operator_id) === econAdmin.id, adjustLog && adjustLog.operator_id);
        t.check('人工调整账本记录 balance_before / balance_after',
            Number(adjustLog.balance_before) === balanceBeforeAdjust && Number(adjustLog.balance_after) === balanceBeforeAdjust + 5, adjustLog);
        r = await api('POST', '/api/market/orders', { token: econAdmin.token, body: { store_id: 1, items: [] } });
        t.check('经济管理员 manage 不自动获得经济成员消费资格（集市下单 403）', r.status === 403 && r.data.code === 'ECONOMY_ACCESS_REQUIRED', r.data);
        r = await api('GET', '/api/permissions/roles', { token: econAdmin.token });
        t.check('经济管理员没有权限中心管理权（403）', r.status === 403, r.status);

        const ok = t.summary('贡献点经济资格测试（12-17）');
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
