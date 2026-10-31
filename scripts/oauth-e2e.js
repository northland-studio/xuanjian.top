/**
 * OAuth 端到端测试（在生产服务器上运行）
 * 覆盖：PKCE 公共客户端完整授权流程、机密客户端 secret 校验、错误分支、令牌刷新、
 *       /verify /userinfo /member 兼容性、CDN 鉴权与签名。
 *
 * 用法：node scripts/oauth-e2e.js <admin-jwt>
 */
const crypto = require('node:crypto');
const http = require('node:http');

const BASE = process.env.OAUTH_TEST_BASE || 'http://127.0.0.1:3000';
const ADMIN = process.argv[2] || '';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? ' | ' + extra : '')); }
};

function req(method, path, { body, token, raw } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const u = new URL(BASE + path);
        const r = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method,
                headers: {
                    ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
                    ...(token ? { Authorization: 'Bearer ' + token } : {})
                },
                timeout: 20000
            },
            (res) => {
                let d = '';
                res.on('data', (c) => (d += c));
                res.on('end', () => {
                    let json = null;
                    try { json = JSON.parse(d); } catch {}
                    resolve({ status: res.statusCode, body: d, json, headers: res.headers });
                });
            }
        );
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: 'timeout' }); });
        r.on('error', (e) => resolve({ status: 0, body: e.message }));
        if (data) r.write(data);
        r.end();
    });
}

(async () => {
    console.log('=== 0. 基础端点 ===');
    const scopes = await req('GET', '/api/oauth/scopes');
    ok('/scopes 可访问且返回权限列表', scopes.status === 200 && Array.isArray(scopes.json.scopes) && scopes.json.scopes.length >= 3, JSON.stringify(scopes.json).slice(0, 120));

    const info = await req('GET', '/api/cdn/info');
    ok('/cdn/info 可访问', info.status === 200 && info.json.ok === true, JSON.stringify(info.json).slice(0, 160));

    console.log('\n=== 1. 公共客户端（PKCE）完整流程 ===');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = 'pcl2://oauth/callback';

    const authRes = await req('POST', '/api/oauth/authorize', {
        token: ADMIN,
        body: {
            client_id: 'pcl2-launcher',
            redirect_uri: redirectUri,
            state: 'test-state',
            scope: 'read:user read:member cdn:read',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            decision: 'allow'
        }
    });
    ok('公共客户端授权成功', authRes.status === 200 && authRes.json.ok === true, JSON.stringify(authRes.json).slice(0, 160));
    const authRedirect = authRes.json && authRes.json.redirect;
    const code = authRedirect ? new URL(authRedirect).searchParams.get('code') : null;
    ok('回调带 code', Boolean(code));
    ok('回调保留 state', authRedirect ? new URL(authRedirect).searchParams.get('state') === 'test-state' : false);

    console.log('\n=== 2. 换令牌（PKCE 校验）===');
    const badPkce = await req('POST', '/api/oauth/token', {
        body: { grant_type: 'authorization_code', code, client_id: 'pcl2-launcher', redirect_uri: redirectUri, code_verifier: 'wrong-verifier' }
    });
    ok('错误 code_verifier 被拒绝', badPkce.status === 400 && badPkce.json.error === 'invalid_grant', JSON.stringify(badPkce.json));

    const tokenRes = await req('POST', '/api/oauth/token', {
        body: { grant_type: 'authorization_code', code, client_id: 'pcl2-launcher', redirect_uri: redirectUri, code_verifier: verifier }
    });
    ok('正确 verifier 换到令牌', tokenRes.status === 200 && Boolean(tokenRes.json.access_token), JSON.stringify(tokenRes.json).slice(0, 160));
    ok('返回 refresh_token', Boolean(tokenRes.json.refresh_token));
    ok('scope 正确', String(tokenRes.json.scope || '').includes('cdn:read'), tokenRes.json.scope);
    const accessToken = tokenRes.json.access_token;
    const refreshToken = tokenRes.json.refresh_token;

    console.log('\n=== 3. 用户信息 / 成员身份 ===');
    const verify = await req('GET', '/api/oauth/verify', { token: accessToken });
    ok('/verify 兼容旧格式', verify.status === 200 && verify.json.valid === true && verify.json.user && verify.json.user.id, JSON.stringify(verify.json).slice(0, 160));
    ok('/verify 含 is_member', verify.json.user && typeof verify.json.user.is_member === 'boolean');

    const member = await req('GET', '/api/oauth/member', { token: accessToken });
    ok('/member 返回成员身份', member.status === 200 && member.json.ok === true && typeof member.json.is_member === 'boolean', JSON.stringify(member.json).slice(0, 200));

    const userinfo = await req('GET', '/api/oauth/userinfo', { token: accessToken });
    ok('/userinfo 按 scope 返回', userinfo.status === 200 && userinfo.json.user && userinfo.json.user.id, JSON.stringify(userinfo.json).slice(0, 160));

    console.log('\n=== 4. 令牌刷新 ===');
    const refreshed = await req('POST', '/api/oauth/token', {
        body: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'pcl2-launcher' }
    });
    ok('刷新成功', refreshed.status === 200 && Boolean(refreshed.json.access_token), JSON.stringify(refreshed.json).slice(0, 160));
    const refreshAgain = await req('POST', '/api/oauth/token', {
        body: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'pcl2-launcher' }
    });
    ok('旧 refresh_token 一次性（轮换生效）', refreshAgain.status === 400, JSON.stringify(refreshAgain.json).slice(0, 120));

    console.log('\n=== 5. CDN 鉴权 ===');
    const manifest = await req('GET', '/api/cdn/manifest?prefix=&limit=5', { token: accessToken });
    const isMember = verify.json.user && verify.json.user.is_member;
    if (isMember) {
        ok('会员可读 CDN 清单', manifest.status === 200 && manifest.json.ok === true, JSON.stringify(manifest.json).slice(0, 200));
        const sign = await req('POST', '/api/cdn/sign', { token: accessToken, body: { keys: [manifest.json.items && manifest.json.items[0] ? manifest.json.items[0].key : 'test.txt'], ttl: 60 } });
        ok('会员可签名下载地址', sign.status === 200 && sign.json.ok === true, JSON.stringify(sign.json).slice(0, 200));
    } else {
        ok('非会员访问 CDN 被拒绝（403 not_member）', manifest.status === 403 && manifest.json.error === 'not_member', JSON.stringify(manifest.json).slice(0, 160));
    }

    const noToken = await req('GET', '/api/cdn/manifest');
    ok('无令牌访问 CDN → 401', noToken.status === 401);

    console.log('\n=== 6. 安全校验 ===');
    const badRedirect = await req('POST', '/api/oauth/authorize', {
        token: ADMIN,
        body: { client_id: 'pcl2-launcher', redirect_uri: 'https://evil.example.com/cb', decision: 'allow' }
    });
    ok('redirect_uri 不在白名单被拒绝', badRedirect.status === 400, JSON.stringify(badRedirect.json).slice(0, 120));

    const unknownClient = await req('POST', '/api/oauth/authorize', {
        token: ADMIN,
        body: { client_id: 'not-registered', redirect_uri: redirectUri, decision: 'allow' }
    });
    ok('未注册 client_id 被拒绝', unknownClient.status === 400, JSON.stringify(unknownClient.json).slice(0, 120));

    const noPkce = await req('POST', '/api/oauth/authorize', {
        token: ADMIN,
        body: { client_id: 'pcl2-launcher', redirect_uri: redirectUri, decision: 'allow' }
    });
    ok('公共客户端缺 PKCE 被拒绝', noPkce.status === 400, JSON.stringify(noPkce.json).slice(0, 120));

    const badScope = await req('POST', '/api/oauth/authorize', {
        token: ADMIN,
        body: { client_id: 'pcl2-launcher', redirect_uri: redirectUri, scope: 'admin:all', code_challenge: challenge, decision: 'allow' }
    });
    ok('越权 scope 被拒绝', badScope.status === 400, JSON.stringify(badScope.json).slice(0, 120));

    console.log('\n=== 7. 机密客户端（nork）===');
    const norkVerifier = crypto.randomBytes(32).toString('base64url');
    const norkChallenge = crypto.createHash('sha256').update(norkVerifier).digest('base64url');
    const norkAuth = await req('POST', '/api/oauth/authorize', {
        token: ADMIN,
        body: {
            client_id: 'nork',
            redirect_uri: 'https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback',
            state: 'nork-test',
            scope: 'read:user read:member',
            decision: 'allow'
        }
    });
    ok('nork 授权成功（机密客户端可不带 PKCE）', norkAuth.status === 200 && norkAuth.json.ok === true, JSON.stringify(norkAuth.json).slice(0, 160));
    const norkCode = norkAuth.json.redirect ? new URL(norkAuth.json.redirect).searchParams.get('code') : null;
    const norkBadSecret = await req('POST', '/api/oauth/token', {
        body: { grant_type: 'authorization_code', code: norkCode, client_id: 'nork', redirect_uri: 'https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback', client_secret: 'wrong-secret' }
    });
    ok('nork 错误 secret 被拒绝', norkBadSecret.status === 401, JSON.stringify(norkBadSecret.json).slice(0, 120));

    console.log('\n=== 8. 授权码复用检测（会连带吊销刷新令牌，故放最后） ===');
    const reuse = await req('POST', '/api/oauth/token', {
        body: { grant_type: 'authorization_code', code, client_id: 'pcl2-launcher', redirect_uri: redirectUri, code_verifier: verifier }
    });
    ok('授权码不可复用', reuse.status === 400, JSON.stringify(reuse.json).slice(0, 120));

    console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
    process.exit(fail ? 1 : 0);
})().catch((e) => {
    console.error('测试异常：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
