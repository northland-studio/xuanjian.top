/**
 * 注册 / 更新 OAuth 客户端
 *
 * 用法：node scripts/register-oauth-clients.js clients.json
 *
 * clients.json 结构：
 * [
 *   {
 *     "client_id": "nork",
 *     "name": "Nork",
 *     "description": "...",
 *     "is_confidential": true,
 *     "redirect_uris": ["https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback"],
 *     "allowed_scopes": ["read:user", "read:member"],
 *     "owner_contact": "...",
 *     "homepage": "https://nork.xuanjian.top",
 *     "secret": "已有密钥（用于计算哈希）",       // 与 generate_secret 二选一
 *     "generate_secret": false
 *   }
 * ]
 *
 * 幂等：client_id 已存在则更新配置；提供 secret/generate_secret 时才更新密钥。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../database');

const oauth = require('../lib/oauth');

(async () => {
    const file = process.argv[2];
    if (!file || !fs.existsSync(file)) {
        console.error('用法：node scripts/register-oauth-clients.js <clients.json>');
        process.exit(2);
    }
    const clients = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(clients) || !clients.length) {
        console.error('clients.json 必须是非空数组');
        process.exit(2);
    }

    const results = [];
    for (const c of clients) {
        const clientId = String(c.client_id || '').trim();
        if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(clientId)) {
            console.error('✗ 非法 client_id：' + clientId);
            continue;
        }
        const redirectUris = oauth.parseList(c.redirect_uris);
        const scopes = oauth.parseList(c.allowed_scopes).filter((s) => oauth.ALL_SCOPES.includes(s));
        if (!redirectUris.length || !scopes.length) {
            console.error('✗ ' + clientId + '：redirect_uris / allowed_scopes 不完整');
            continue;
        }
        const confidential = c.is_confidential === undefined ? true : Boolean(c.is_confidential);

        let secret = null;
        if (c.generate_secret) secret = oauth.generateClientSecret();
        else if (c.secret) secret = String(c.secret);
        const secretHash = secret ? oauth.sha256(secret) : null;

        const existing = await db.get('SELECT * FROM oauth_clients WHERE client_id = ?', [clientId]);
        if (existing) {
            await db.run(
                `UPDATE oauth_clients
                    SET name = ?, description = ?, is_confidential = ?, redirect_uris = ?, allowed_scopes = ?,
                        owner_contact = ?, homepage = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
                        ${secretHash ? ', client_secret_hash = ?' : ''}
                  WHERE client_id = ?`,
                [
                    String(c.name || clientId).slice(0, 100),
                    String(c.description || '').slice(0, 500),
                    confidential ? 1 : 0,
                    JSON.stringify(redirectUris),
                    JSON.stringify(scopes),
                    String(c.owner_contact || '').slice(0, 200),
                    String(c.homepage || '').slice(0, 300),
                    ...(secretHash ? [secretHash] : []),
                    clientId
                ]
            );
            results.push({ clientId, action: 'updated', secret, confidential });
        } else {
            await db.run(
                `INSERT INTO oauth_clients (client_id, name, description, client_secret_hash, is_confidential, redirect_uris, allowed_scopes, owner_contact, homepage)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    clientId,
                    String(c.name || clientId).slice(0, 100),
                    String(c.description || '').slice(0, 500),
                    secretHash,
                    confidential ? 1 : 0,
                    JSON.stringify(redirectUris),
                    JSON.stringify(scopes),
                    String(c.owner_contact || '').slice(0, 200),
                    String(c.homepage || '').slice(0, 300)
                ]
            );
            results.push({ clientId, action: 'created', secret, confidential });
        }

        await oauth.audit(existing ? 'client_updated' : 'client_created', { clientId, detail: 'by=script' });
    }

    console.log('=== 注册结果 ===');
    for (const r of results) {
        console.log(`  ${r.action === 'created' ? '✓ 新增' : '✓ 更新'} ${r.clientId}（${r.confidential ? '机密客户端' : '公共客户端 PKCE'}）`);
        if (r.secret) console.log(`      secret = ${r.secret}`);
    }

    const all = await db.all('SELECT client_id, name, is_confidential, redirect_uris, allowed_scopes, is_active FROM oauth_clients ORDER BY id');
    console.log('\n=== 当前全部应用 ===');
    all.forEach((c) => console.log(`  - ${c.client_id} (${c.name}) 机密=${c.is_confidential} 启用=${c.is_active} scopes=${c.allowed_scopes} redirects=${c.redirect_uris}`));

    // 输出给部署脚本消费的 JSON（含生成的 secret，便于同步到各项目 .env）
    const outFile = path.join(path.dirname(file), 'oauth-clients-result.json');
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
    console.log('\n结果已写入：' + outFile);
    process.exit(0);
})().catch((e) => {
    console.error('注册失败：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
