/**
 * 硅基流动 Embedding 客户端（BAAI/bge-m3）
 *
 * 要求（任务书 4.3）：
 *  - 服务端统一封装，支持批量；
 *  - 429 / 5xx / 网络故障有限次指数退避；
 *  - 明确处理超时、401、无效 JSON、空向量、模型名错误；
 *  - 校验返回条数、维度、有限数值，不合格不得写入向量表；
 *  - 记录模型名/维度/分块版本。
 */
const https = require('node:https');
const config = require('./config');

class EmbeddingError extends Error {
    constructor(message, { type = 'unknown', retryable = false, status = 0 } = {}) {
        super(message);
        this.name = 'EmbeddingError';
        this.type = type;
        this.retryable = retryable;
        this.status = status;
    }
}

function postJson(url, headers, body, timeoutMs) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const data = JSON.stringify(body);
        const req = https.request(
            {
                hostname: u.hostname,
                port: u.port || 443,
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
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'request timeout' }); });
        req.on('error', (e) => resolve({ status: 0, body: e.message }));
        req.write(data);
        req.end();
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 解析响应并校验向量质量 */
function validateResponse(payload, expectedCount, expectedDim) {
    const list = Array.isArray(payload && payload.data) ? payload.data : null;
    if (!list) throw new EmbeddingError('响应缺少 data 数组', { type: 'invalid_response' });
    if (list.length !== expectedCount) {
        throw new EmbeddingError(`返回条数不符：期望 ${expectedCount}，实际 ${list.length}`, { type: 'invalid_response' });
    }
    const vectors = [];
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        // 部分实现返回 index 字段，需确认顺序对应
        if (item && typeof item.index === 'number' && item.index !== i) {
            throw new EmbeddingError(`返回顺序错乱：位置 ${i} 的 index=${item.index}`, { type: 'invalid_response' });
        }
        const vec = item && item.embedding;
        if (!Array.isArray(vec) || vec.length === 0) {
            throw new EmbeddingError(`第 ${i} 条向量为空`, { type: 'empty_vector' });
        }
        if (vec.length !== expectedDim) {
            throw new EmbeddingError(`维度不符：期望 ${expectedDim}，实际 ${vec.length}`, { type: 'dimension_mismatch' });
        }
        for (let k = 0; k < vec.length; k++) {
            if (typeof vec[k] !== 'number' || !Number.isFinite(vec[k])) {
                throw new EmbeddingError(`第 ${i} 条向量含非法数值（位置 ${k}）`, { type: 'invalid_vector' });
            }
        }
        vectors.push(vec);
    }
    return vectors;
}

/**
 * 批量 Embedding
 * @param {string[]} texts
 * @returns {{vectors:number[][], model:string, dimension:number, tokens:number, isRealUsage:boolean}}
 */
async function embed(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
        throw new EmbeddingError('没有需要向量化的文本', { type: 'bad_request' });
    }
    const cfg = await config.getAll();
    const apiKey = await config.apiKey('embedding');
    if (!apiKey) throw new EmbeddingError('未配置 Embedding API Key', { type: 'no_key' });

    const url = String(cfg['embedding.baseUrl']).replace(/\/+$/, '') + '/embeddings';
    const model = cfg['embedding.model'];
    const expectedDim = Number(cfg['embedding.dimension']) || 1024;

    // 单批文本量限制，避免一次提交过多正文
    const batchSize = Math.max(1, Math.min(64, Number(cfg['embedding.batchSize']) || 8));
    const maxChars = Number(cfg['embedding.maxCharsPerBatch']) || 8000;

    const vectors = [];
    let tokens = 0;
    let isRealUsage = true;

    for (let start = 0; start < texts.length; start += batchSize) {
        let batch = texts.slice(start, start + batchSize);
        // 超长批次拆分
        while (batch.join('').length > maxChars && batch.length > 1) {
            batch = batch.slice(0, Math.ceil(batch.length / 2));
        }

        let attempt = 0;
        let lastError = null;
        while (attempt < 4) {
            attempt++;
            const res = await postJson(url, { Authorization: `Bearer ${apiKey}` }, { model, input: batch, encoding_format: 'float' }, 60000);

            if (res.status === 200) {
                let payload;
                try {
                    payload = JSON.parse(res.body);
                } catch {
                    throw new EmbeddingError('响应不是合法 JSON', { type: 'invalid_response' });
                }
                const got = validateResponse(payload, batch.length, expectedDim);
                vectors.push(...got);
                const used = payload && payload.usage && payload.usage.total_tokens;
                if (typeof used === 'number') tokens += used;
                else isRealUsage = false;
                lastError = null;
                break;
            }

            const body = String(res.body || '').slice(0, 300);
            if (res.status === 401 || res.status === 403) {
                throw new EmbeddingError('Embedding 认证失败（检查 API Key）：' + body, { type: 'auth', status: res.status });
            }
            if (res.status === 429 || res.status >= 500 || res.status === 0) {
                lastError = new EmbeddingError(
                    `Embedding 临时故障（${res.status}）：${body}`,
                    { type: res.status === 429 ? 'rate_limit' : 'server', retryable: true, status: res.status }
                );
                await sleep(Math.min(8000, 400 * Math.pow(2, attempt)));
                continue;
            }
            // 其余 4xx：模型名/参数问题，不重试
            const isModelError = /model|not found|invalid/i.test(body);
            throw new EmbeddingError(
                `Embedding 请求失败（${res.status}）：${body}`,
                { type: isModelError ? 'model' : 'bad_request', status: res.status }
            );
        }
        if (lastError) throw lastError;
    }

    // 记录索引元信息（模型/维度）
    await config.setMeta('embedding.lastModel', model);
    await config.setMeta('embedding.lastDimension', String(expectedDim));

    return { vectors, model, dimension: expectedDim, tokens, isRealUsage };
}

/** 单条便捷方法 */
async function embedOne(text) {
    const r = await embed([text]);
    return { vector: r.vectors[0], model: r.model, dimension: r.dimension, tokens: r.tokens, isRealUsage: r.isRealUsage };
}

/** 连通性测试：返回可诊断结果，不抛异常 */
async function test() {
    try {
        const r = await embed(['玄剑公会制度连通性测试']);
        return {
            ok: true,
            model: r.model,
            dimension: r.dimension,
            tokens: r.tokens,
            vectorLength: r.vectors[0] ? r.vectors[0].length : 0
        };
    } catch (e) {
        return { ok: false, error: e.message, type: e.type || 'unknown', status: e.status || 0 };
    }
}

module.exports = { embed, embedOne, test, EmbeddingError };
