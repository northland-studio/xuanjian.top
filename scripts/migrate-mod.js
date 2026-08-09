// 迁移：模组联动支持 —— mod_bindings（UUID↔官网账号绑定）、mod_servers（服务器密钥）、mod_online（在线玩家上报）、mod_active（活跃心跳）
const crypto = require('crypto');
const db = require('../database');

(async () => {
    try {
        // 1. 绑定表：游戏 UUID ↔ 官网用户
        await db.run(`
            CREATE TABLE IF NOT EXISTS mod_bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                player_name TEXT NOT NULL,
                bind_code TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                confirmed_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        console.log('[ok] mod_bindings 表就绪');

        // 2. 服务器表：管理后台注册公会游戏服务器（含密钥）
        await db.run(`
            CREATE TABLE IF NOT EXISTS mod_servers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_key TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                server_ip TEXT DEFAULT '',
                last_seen_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[ok] mod_servers 表就绪');

        // 3. 在线玩家表：模组心跳上报
        await db.run(`
            CREATE TABLE IF NOT EXISTS mod_online (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_ip TEXT NOT NULL,
                uuid TEXT NOT NULL,
                player_name TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(server_ip, uuid)
            )
        `);
        console.log('[ok] mod_online 表就绪');

        // 4. 活跃心跳表：官网「活跃总人数」统计
        await db.run(`
            CREATE TABLE IF NOT EXISTS mod_active (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE NOT NULL,
                player_name TEXT DEFAULT '',
                last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[ok] mod_active 表就绪');

        // 5. 默认服务器密钥（若不存在）
        const defaultServer = await db.get('SELECT id FROM mod_servers LIMIT 1');
        if (!defaultServer) {
            const key = 'xjk_' + crypto.randomBytes(16).toString('hex');
            await db.run(
                'INSERT INTO mod_servers (server_key, name) VALUES (?, ?)',
                [key, '默认公会服务器']
            );
            console.log(`[ok] 已生成默认服务器密钥: ${key}`);
            console.log('     请在服务器 config/xuanjianmod.properties 的 server.key 中填入该密钥');
        }

        db.close();
        process.exit(0);
    } catch (e) {
        console.error('迁移失败:', e);
        process.exit(1);
    }
})();
