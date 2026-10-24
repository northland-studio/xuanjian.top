/**
 * 模型连通性验证：硅基流动 BGE-M3 Embedding + DeepSeek deepseek-flash
 * 用法：node scripts/rag/verify-models.js
 *
 * 只验证「能不能用、维度对不对、模型名有效」，不写入任何数据。
 */
const https = require('https');

const EMB_KEY = process.env.RAG_EMBEDDING_KEY || 'sk-prglmnpvrtzhelluumkmxrcavlpxvozehfglpkwqknyvzjza';
const LLM_KEY = process.env.RAG_LLM_KEY || 'sk-33a0de06305a4e6494fe4644e289eecc';

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
    console.log('=== 1. 硅基流动 Embedding（BAAI/bge-m3）===');
    const emb = await post(
        'https://api.siliconflow.cn/v1/embeddings',
        { Authorization: `Bearer ${EMB_KEY}` },
        { model: 'BAAI/bge-m3', input: ['玄剑公会的仓库管理制度是什么？', '入会申请需要满足哪些条件？'], encoding_format: 'float' }
    );
    console.log('  HTTP ' + emb.status);
    if (emb.status === 200) {
        try {
            const j = JSON.parse(emb.body);
            const dims = (j.data || []).map((d) => (d.embedding || []).length);
            const finite = (j.data || []).every((d) => (d.embedding || []).every((x) => Number.isFinite(x)));
            console.log('  返回条数: ' + (j.data || []).length + '（输入 2 条）');
            console.log('  向量维度: ' + JSON.stringify(dims));
            console.log('  数值有限: ' + finite);
            console.log('  用量: ' + JSON.stringify(j.usage || {}));
            console.log(dims.length === 2 && dims.every((d) => d === 1024) ? '  ✓ 维度 1024 符合预期' : '  ✗ 维度异常');
        } catch (e) {
            console.log('  解析失败: ' + emb.body.slice(0, 300));
        }
    } else {
        console.log('  ' + emb.body.slice(0, 300));
    }

    console.log('\n=== 2. DeepSeek（deepseek-flash）===');
    for (const model of ['deepseek-flash', 'deepseek-chat']) {
        const llm = await post(
            'https://api.deepseek.com/chat/completions',
            { Authorization: `Bearer ${LLM_KEY}` },
            { model, messages: [{ role: 'user', content: '只回复两个字：可用' }], max_tokens: 16, temperature: 0 }
        );
        console.log(`  [${model}] HTTP ${llm.status}`);
        if (llm.status === 200) {
            try {
                const j = JSON.parse(llm.body);
                console.log('    回复: ' + (j.choices?.[0]?.message?.content || '').trim().slice(0, 40));
                console.log('    用量: ' + JSON.stringify(j.usage || {}));
            } catch { console.log('    ' + llm.body.slice(0, 200)); }
        } else {
            console.log('    ' + llm.body.slice(0, 200));
        }
    }
    process.exit(0);
})();
