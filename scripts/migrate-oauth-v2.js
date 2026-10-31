/**
 * 迁移：OAuth 2.0 服务端升级（v2）
 *
 * 新增：
 *  - oauth_clients        应用注册表（client_id / 密钥哈希 / 回调白名单 / scope / 机密类型）
 *  - oauth_codes          授权码持久化（含 PKCE 绑定、一次性使用）
 *  - oauth_refresh_tokens 刷新令牌（哈希存储，可吊销）
 *  - oauth_audit_logs     接入审计（谁在什么时候授权了谁）
 *
 * 幂等：可重复执行。
 */
const db = require('../database');

(async () => {
    console.log('=== OAuth v2 迁移 ===');

    await db.run(`CREATE TABLE IF NOT EXISTS oauth_clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        client_secret_hash TEXT,
        is_confidential INTEGER NOT NULL DEFAULT 1,
        redirect_uris TEXT NOT NULL DEFAULT '[]',
        allowed_scopes TEXT NOT NULL DEFAULT '[]',
        owner_contact TEXT,
        homepage TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME
    )`);
    console.log('✓ oauth_clients');

    await db.run(`CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT '',
        code_challenge TEXT,
        code_challenge_method TEXT,
        expires_at INTEGER NOT NULL,
        used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_oauth_codes_expire ON oauth_codes(expires_at)');
    console.log('✓ oauth_codes');

    await db.run(`CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        scope TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL,
        revoked_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_oauth_refresh_user ON oauth_refresh_tokens(user_id)');
    console.log('✓ oauth_refresh_tokens');

    await db.run(`CREATE TABLE IF NOT EXISTS oauth_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        client_id TEXT,
        user_id INTEGER,
        ip TEXT,
        user_agent TEXT,
        detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run('CREATE INDEX IF NOT EXISTS idx_oauth_audit_time ON oauth_audit_logs(created_at)');
    console.log('✓ oauth_audit_logs');

    // 清理过期授权码
    const cleaned = await db.run('DELETE FROM oauth_codes WHERE expires_at < ?', [Math.floor(Date.now() / 1000) - 3600]);
    console.log('✓ 清理过期授权码：' + (cleaned.changes || 0) + ' 条');

    const clients = await db.all('SELECT client_id, name, is_confidential, is_active FROM oauth_clients ORDER BY id');
    console.log('✓ 已注册应用 ' + clients.length + ' 个');
    clients.forEach((c) => console.log('   - ' + c.client_id + ' (' + c.name + ') 机密=' + (c.is_confidential ? '是' : '否') + ' 启用=' + (c.is_active ? '是' : '否')));

    console.log('=== 完成 ===');
    process.exit(0);
})().catch((e) => {
    console.error('迁移失败：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
