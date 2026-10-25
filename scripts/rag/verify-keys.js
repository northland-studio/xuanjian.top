/**
 * 校验两把 Key：硅基流动 Embedding Key + 新 DeepSeek LLM Key
 * 用法：node verify-keys.mjs
 */
const https = require('node:https');

const EMB_KEY = process.env.EMB_KEY || '';
const LLM_KEY = process.env.LLM_KEY || '';

function post(url, headers, body, timeoutMs = 60000) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const data = JSON.stringify(body);
        const req = https.request(
            {
                hostname: u.hostname,
                path: u.pathname + u.search,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
                timeout: timeoutMs
            },
            (res) => {
                let d = '';
                res.on('data', (c) => (d += c));
                res.on('end', () => resolve({ status: res.statusCode, body: d }));
            }
        );
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
        req.on('error', (e) => resolve({ status: 0, body: e.message }));
        req.write(data);
        req.end();
    });
}

(async () => {
    console.log('=== 1. Embedding Key（硅基流动 BAAI/bge-m3）===');
    console.log('  Key: ' + EMB_KEY.slice(0, 8) + '****' + EMB_KEY.slice(-4) + '（长度 ' + EMB_KEY.length + '）');
    const emb = await post(
        'https://api.siliconflow.cn/v1/embeddings',
        { Authorization: 'Bearer ' + EMB_KEY },
        { model: 'BAAI/bge-m3', input: ['玄剑公会的入会条件是什么'], encoding_format: 'float' }
    );
    console.log('  HTTP ' + emb.status);
    if (emb.status === 200) {
        const j = JSON.parse(emb.body);
        const dim = (j.data && j.data[0] && j.data[0].embedding || []).length;
        console.log('  ✓ 可用：向量维度 ' + dim + '，用量 ' + JSON.stringify(j.usage || {}));
    } else {
        console.log('  ✗ ' + emb.body.slice(0, 300));
    }

    console.log('\n=== 2. LLM Key（DeepSeek deepseek-flash）===');
    console.log('  Key: ' + LLM_KEY.slice(0, 8) + '****' + LLM_KEY.slice(-4) + '（长度 ' + LLM_KEY.length + '）');
    const llm = await post(
        'https://api.deepseek.com/chat/completions',
        { Authorization: 'Bearer ' + LLM_KEY },
        {
            model: 'deepseek-flash',
            messages: [{ role: 'user', content: '只回复两个字：可用' }],
            max_tokens: 300,
            temperature: 0,
            thinking: { type: 'disabled' }
        }
    );
    console.log('  HTTP ' + llm.status);
    if (llm.status === 200) {
        const j = JSON.parse(llm.body);
        const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
        console.log('  ✓ 可用：回复「' + String(msg.content || '').trim() + '」，用量 ' + JSON.stringify(j.usage || {}));
    } else {
        console.log('  ✗ ' + llm.body.slice(0, 300));
    }
    process.exit(0);
})();
