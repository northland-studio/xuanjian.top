/**
 * deepseek-flash 行为探测：它是推理型模型（reasoning_tokens 吃掉了 max_tokens，content 为空）
 * 这里确认：1) 放宽 max_tokens 后能否拿到正文；2) 是否支持关闭思考的参数
 */
const https = require('https');
const LLM_KEY = process.env.RAG_LLM_KEY || 'sk-33a0de06305a4e6494fe4644e289eecc';

function post(url, headers, body) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const data = JSON.stringify(body);
        const req = https.request(
            { hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }, timeout: 90000 },
            (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); }
        );
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
        req.on('error', (e) => resolve({ status: 0, body: e.message }));
        req.write(data);
        req.end();
    });
}

const Q = '用一句话说明：为什么回答必须只依据检索到的文档？';

async function tryCall(label, body) {
    const r = await post('https://api.deepseek.com/chat/completions', { Authorization: `Bearer ${LLM_KEY}` }, body);
    console.log(`\n[${label}] HTTP ${r.status}`);
    if (r.status !== 200) { console.log('  ' + r.body.slice(0, 260)); return; }
    const j = JSON.parse(r.body);
    const msg = j.choices?.[0]?.message || {};
    console.log('  content: ' + JSON.stringify((msg.content || '').slice(0, 120)));
    console.log('  reasoning: ' + JSON.stringify(String(msg.reasoning_content || '').slice(0, 60)));
    console.log('  usage: ' + JSON.stringify(j.usage || {}));
}

(async () => {
    const base = { messages: [{ role: 'user', content: Q }], temperature: 0.2 };

    await tryCall('flash max_tokens=800', { ...base, model: 'deepseek-flash', max_tokens: 800 });
    await tryCall('flash thinking.disabled', { ...base, model: 'deepseek-flash', max_tokens: 300, thinking: { type: 'disabled' } });
    await tryCall('flash reasoning_effort=low', { ...base, model: 'deepseek-flash', max_tokens: 300, reasoning_effort: 'low' });
    process.exit(0);
})();
