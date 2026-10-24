/**
 * 硅基流动账户与免费模型核查：确认 402 到底是余额问题还是模型计费问题
 */
const https = require('node:https');
const KEY = process.env.RAG_EMBEDDING_KEY || 'sk-prglmnpvrtzhelluumkmxrcavlpxvozehfglpkwqknyvzjza';

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
                    Authorization: `Bearer ${KEY}`,
                    ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
                    ...headers
                },
                timeout: 40000
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
    console.log('=== 1. 账户信息 ===');
    const info = await req('GET', 'https://api.siliconflow.cn/v1/user/info');
    console.log('HTTP ' + info.status);
    console.log('  ' + info.body.slice(0, 600));

    console.log('\n=== 2. bge-m3 单条 Embedding ===');
    const emb = await req('POST', 'https://api.siliconflow.cn/v1/embeddings', {}, {
        model: 'BAAI/bge-m3',
        input: ['测试'],
        encoding_format: 'float'
    });
    console.log('HTTP ' + emb.status);
    console.log('  ' + emb.body.slice(0, 400));

    console.log('\n=== 3. 模型是否存在/计费方式 ===');
    const models = await req('GET', 'https://api.siliconflow.cn/v1/models?sub_type=embedding');
    console.log('HTTP ' + models.status);
    try {
        const j = JSON.parse(models.body);
        const target = (j.data || []).filter((m) => /bge-m3/i.test(m.id || ''));
        target.forEach((m) => console.log('  ' + m.id + ' | ' + JSON.stringify(m.pricing || m)));
    } catch {
        console.log('  ' + models.body.slice(0, 300));
    }
    process.exit(0);
})();
