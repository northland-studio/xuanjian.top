/**
 * 验证 deepseek-chat 是否被平台路由到 deepseek-v4-pro（怀疑这是 v4-pro 账单来源）
 * 用法：LLM_KEY=sk-xxx node probe-chat-alias.js
 */
const https = require('node:https');
const KEY = process.env.LLM_KEY || '';
if (!KEY) { console.error('需要 LLM_KEY'); process.exit(2); }

function post(body) {
    return new Promise((resolve) => {
        const u = new URL('https://api.deepseek.com/chat/completions');
        const data = JSON.stringify(body);
        const req = https.request(
            {
                hostname: u.hostname,
                path: u.pathname,
                method: 'POST',
                headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
                timeout: 60000
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
    for (const model of ['deepseek-chat', 'deepseek-flash', 'deepseek-deepseek-chat']) {
        const r = await post({
            model,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 5,
            thinking: { type: 'disabled' }
        });
        if (r.status !== 200) {
            console.log(`  [${model}] HTTP ${r.status}: ${r.body.slice(0, 160)}`);
            continue;
        }
        const j = JSON.parse(r.body);
        console.log(`  [请求 ${model}] → 实际返回 model = ${j.model}`);
    }
    process.exit(0);
})();
