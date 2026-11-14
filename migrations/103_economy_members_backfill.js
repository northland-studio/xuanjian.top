/**
 * 103 — 现有贡献点用户 → 「玄剑经济成员」角色（幂等、可核对）
 *
 * 规则（见规范第十一条）：
 *  - 自动识别“已有经济账户或历史经济记录”的用户（贡献点非 0 / 有流水 / 参与过转账），加入默认「玄剑经济成员」角色；
 *  - 不修改余额、不删除流水、不改历史交易、不动集市托管账户语义；
 *  - **不把系统账号（level = -1，如 market_escrow）加入**；
 *  - 新用户不自动获得经济资格；外会人员后续可移除该角色。
 *
 * 幂等：INSERT OR IGNORE（permission_role_members 主键 role_id+user_id）。
 * 备份/回滚：由 migrations/run.js --backup 在执行前 VACUUM INTO 备份整库；
 *            回滚只需恢复备份，本迁移不改动任何经济数据。
 */
module.exports = {
    id: 103,
    name: 'economy_members_backfill',
    up: async (db) => {
        await db.exec(`CREATE TABLE IF NOT EXISTS permission_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            actor_id INTEGER,
            target_type TEXT,
            target_id TEXT,
            before_json TEXT,
            after_json TEXT,
            note TEXT,
            ip TEXT,
            created_at TEXT NOT NULL
        )`);

        const tableExists = async (name) => {
            const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name]);
            return !!row;
        };
        const hasLogs = await tableExists('contribution_logs');
        const hasTransfers = await tableExists('transfers');

        const role = await db.get("SELECT id, name, status FROM permission_roles WHERE key = 'economy_member'");
        if (!role) {
            throw new Error('系统角色「玄剑经济成员」(economy_member) 不存在，请先执行 102 迁移');
        }

        async function collectStats() {
            const userCount = (await db.get('SELECT COUNT(*) AS c FROM users')).c;
            const systemAccountCount = (await db.get('SELECT COUNT(*) AS c FROM users WHERE COALESCE(level, 0) < 0')).c;
            const totalBalance = (await db.get('SELECT COALESCE(SUM(COALESCE(contribution, 0)), 0) AS s FROM users')).s;
            const logCount = hasLogs ? (await db.get('SELECT COUNT(*) AS c FROM contribution_logs')).c : 0;
            const transferCount = hasTransfers ? (await db.get('SELECT COUNT(*) AS c FROM transfers')).c : 0;
            const roleMemberCount = (await db.get('SELECT COUNT(*) AS c FROM permission_role_members WHERE role_id = ?', [role.id])).c;
            // “经济账户数量”：有余额变动或有历史流水的非系统账号
            let economyAccountCount = 0;
            if (hasLogs) {
                economyAccountCount = (await db.get(`SELECT COUNT(*) AS c FROM users u
                    WHERE COALESCE(u.level, 0) >= 0
                      AND (COALESCE(u.contribution, 0) != 0
                           OR EXISTS (SELECT 1 FROM contribution_logs cl WHERE cl.user_id = u.id))`)).c;
            } else {
                economyAccountCount = (await db.get(`SELECT COUNT(*) AS c FROM users
                    WHERE COALESCE(level, 0) >= 0 AND COALESCE(contribution, 0) != 0`)).c;
            }
            return { userCount, systemAccountCount, economyAccountCount, totalBalance, logCount, transferCount, roleMemberCount };
        }

        const before = await collectStats();

        // 候选用户：非系统账号 + 有经济账户或历史记录
        const conditions = ['COALESCE(u.contribution, 0) != 0'];
        if (hasLogs) conditions.push('EXISTS (SELECT 1 FROM contribution_logs cl WHERE cl.user_id = u.id)');
        if (hasTransfers) {
            conditions.push('EXISTS (SELECT 1 FROM transfers t WHERE t.from_user = u.id OR t.to_user = u.id)');
        }
        const candidates = await db.all(
            `SELECT u.id, COALESCE(u.level, 0) AS level, COALESCE(u.contribution, 0) AS contribution
               FROM users u
              WHERE COALESCE(u.level, 0) >= 0
                AND (${conditions.join(' OR ')})
              ORDER BY u.id`
        );
        const eligible = candidates.filter(u => Number(u.level) >= 0);

        const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
        let inserted = 0;
        for (const u of eligible) {
            const r = await db.run(
                `INSERT OR IGNORE INTO permission_role_members (role_id, user_id, granted_by, created_at)
                 VALUES (?, ?, NULL, ?)`,
                [role.id, u.id, ts]
            );
            if (r.changes > 0) inserted++;
        }

        const after = await collectStats();
        const report = {
            migration: '103_economy_members_backfill',
            role: { id: role.id, key: 'economy_member', name: role.name },
            before,
            after,
            candidates: candidates.length,
            eligible: eligible.length,
            inserted,
            skippedSystemAccounts: candidates.length - eligible.length,
            generatedAt: new Date().toISOString()
        };
        console.log('  经济成员迁移核对：');
        console.log(`    用户数 ${before.userCount} → ${after.userCount}（系统账号 ${after.systemAccountCount} 个未加入）`);
        console.log(`    经济账户数 ${before.economyAccountCount} → ${after.economyAccountCount}`);
        console.log(`    贡献点总余额 ${before.totalBalance} → ${after.totalBalance}（必须不变）`);
        console.log(`    历史流水数 ${before.logCount} → ${after.logCount}（必须不变）`);
        console.log(`    角色成员数 ${before.roleMemberCount} → ${after.roleMemberCount}（本次新增 ${inserted}）`);

        if (before.totalBalance !== after.totalBalance) throw new Error('贡献点总余额发生变化，迁移中止');
        if (before.logCount !== after.logCount) throw new Error('历史流水数量发生变化，迁移中止');
        if (after.roleMemberCount !== before.roleMemberCount + inserted) {
            throw new Error('角色成员数量核对失败，迁移中止');
        }

        await db.run(
            `INSERT INTO permission_audit_logs (action, actor_id, target_type, target_id, before_json, after_json, note, ip, created_at)
             VALUES ('economy_backfill', NULL, 'role', ?, ?, ?, ?, NULL, ?)`,
            [String(role.id), JSON.stringify(before), JSON.stringify(report),
                `迁移 103：现有贡献点用户加入「玄剑经济成员」角色（新增 ${inserted}）`, ts]
        );
        return report;
    }
};
