/**
 * 判定硅基流动 402 是「Key 无效」还是「账户欠费」：
 *  - /v1/models 能列模型 → Key 有效（鉴权通过）
 *  - /v1/embeddings 402 → 账户余额不足（免费模型也会被拦）
 * 用法：node probe-embedding-account.js <key>
 */
const https = require('node:https');

const KEY = process.argv[2] || process.env.EMB_KEY || '';
if (!KEY) {
    console.error('用法: node probe-embedding-account.js <key>');
    process.exit(2);
}
console.log('Key: ' + KEY.slice(0, 8) + '****' + KEY.slice(-4) + '（长度 ' + KEY.length + '）');

function req(method, url, headers, body) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const data = body ? JSON.stringify(body) : null;
        const r = https.request(
            {
                hostname: u.hostname,
                path: u.pathname + u.search,
                method,
                headers: {
                    Authorization: 'Bearer ' + KEY,
                    ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
                    ...headers
                },
                timeout: 30000
            },
            (res) => {
                let d = '';
                res.on('data', (c) => (d += c));
                res.on('end', () => resolve({ status: res.statusCode, body: d }));
            }
        );
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: 'timeout' }); });
        r.on('error', (e) => resolve({ status: 0, body: e.message }));
        if (data) r.write(data);
        r.end();
    });
}

(async () => {
    console.log('\n[1] 鉴权检查 GET /v1/models');
    const m = await req('GET', 'https://api.siliconflow.cn/v1/models');
    console.log('  HTTP ' + m.status);
    if (m.status === 200) {
        const j = JSON.parse(m.body);
        const list = (j.data || []).map((x) => x.id);
        console.log('  ✓ Key 有效，可见模型 ' + list.length + ' 个');
        console.log('  含 bge-m3: ' + list.includes('BAAI/bge-m3'));
    } else {
        console.log('  ✗ ' + m.body.slice(0, 200));
    }

    console.log('\n[2] 计费检查 POST /v1/embeddings（bge-m3，免费模型）');
    const e = await req('POST', 'https://api.siliconflow.cn/v1/embeddings', {}, {
        model: 'BAAI/bge-m3',
        input: ['测试'],
        encoding_format: 'float'
    });
    console.log('  HTTP ' + e.status);
    console.log('  ' + e.body.slice(0, 240));

    console.log('\n[3] 结论');
    if (m.status === 200 && e.status === 402) {
        console.log('  Key 本身有效（能列模型），但该账户余额不足 → 402 是账户级限制，换 Key 无效，需要充值。');
    } else if (m.status === 401) {
        console.log('  Key 无效或已删除（401）。');
    } else if (e.status === 200) {
        console.log('  可用。');
    }
    process.exit(0);
})();
