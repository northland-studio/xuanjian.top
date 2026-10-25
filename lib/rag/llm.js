/**
 * DeepSeek LLM 客户端（deepseek-flash）
 *
 * 实测结论：deepseek-flash 是推理模型，默认会消耗 reasoning_tokens；
 * max_tokens 太小时 content 会为空。这里默认发送 thinking:{type:'disabled'}（可配置关闭），
 * 并保证 max_tokens 足够，同时把「是否估算用量」如实返回。
 */
const https = require('node:https');
const config = require('./config');

class LlmError extends Error {
    constructor(message, { type = 'unknown', retryable = false, status = 0 } = {}) {
        super(message);
        this.name = 'LlmError';
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

/**
 * 对话补全
 * @param {{messages:Array, maxTokens?:number, temperature?:number, timeoutMs?:number}} opts
 */
async function chat(opts) {
    const cfg = await config.getAll();
    const apiKey = await config.apiKey('llm');
    if (!apiKey) throw new LlmError('未配置 LLM API Key', { type: 'no_key' });

    const url = String(cfg['llm.baseUrl']).replace(/\/+$/, '') + '/chat/completions';
    const model = cfg['llm.model'];
    const disableThinking = cfg['llm.disableThinking'] !== false;
    const maxTokens = Math.max(64, Number(opts.maxTokens || cfg['rag.maxOutputTokens']) || 700);

    const body = {
        model,
        messages: opts.messages,
        temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2,
        max_tokens: maxTokens
    };
    if (disableThinking) body.thinking = { type: 'disabled' };

    let attempt = 0;
    let lastError = null;
    const t0 = Date.now();
    while (attempt < 4) {
        attempt++;
        const res = await postJson(url, { Authorization: `Bearer ${apiKey}` }, body, opts.timeoutMs || 90000);
        if (res.status === 200) {
            let payload;
            try {
                payload = JSON.parse(res.body);
            } catch {
                throw new LlmError('LLM 响应不是合法 JSON', { type: 'invalid_response' });
            }
            const choice = payload && payload.choices && payload.choices[0];
            const message = (choice && choice.message) || {};
            const content = String(message.content || '').trim();
            if (!content) {
                throw new LlmError('LLM 返回空内容（可能 max_tokens 被思考消耗）', { type: 'empty_content' });
            }
            const usage = payload.usage || {};
            const real = typeof usage.total_tokens === 'number';
            // 出站对账日志：模型 / token / 耗时（不含 key 与正文）
            console.log(
                '[llm-out] model=' + (payload.model || model) +
                ' req_model=' + model +
                ' prompt=' + (usage.prompt_tokens || 0) +
                ' completion=' + (usage.completion_tokens || 0) +
                ' total=' + (usage.total_tokens || 0) +
                ' ms=' + (Date.now() - t0)
            );
            return {
                content,
                model,
                reasoning: String(message.reasoning_content || ''),
                usage: real
                    ? {
                        promptTokens: usage.prompt_tokens || 0,
                        completionTokens: usage.completion_tokens || 0,
                        totalTokens: usage.total_tokens || 0,
                        isRealUsage: true
                    }
                    : { promptTokens: 0, completionTokens: 0, totalTokens: 0, isRealUsage: false },
                finishReason: choice && choice.finish_reason
            };
        }

        const text = String(res.body || '').slice(0, 300);
        if (res.status === 401 || res.status === 403) {
            throw new LlmError('LLM 认证失败（检查 API Key）：' + text, { type: 'auth', status: res.status });
        }
        if (res.status === 429 || res.status >= 500 || res.status === 0) {
            lastError = new LlmError(`LLM 临时故障（${res.status}）：${text}`, {
                type: res.status === 429 ? 'rate_limit' : 'server',
                retryable: true,
                status: res.status
            });
            await sleep(Math.min(8000, 400 * Math.pow(2, attempt)));
            continue;
        }
        const isModelError = /model|not found|invalid/i.test(text);
        throw new LlmError(`LLM 请求失败（${res.status}）：${text}`, {
            type: isModelError ? 'model' : 'bad_request',
            status: res.status
        });
    }
    throw lastError || new LlmError('LLM 调用失败', { type: 'unknown' });
}

/** 连通性测试：不抛异常，返回可诊断结果 */
async function test() {
    try {
        const r = await chat({
            messages: [
                { role: 'system', content: '你是测试助手，只输出 JSON。' },
                { role: 'user', content: '输出 {"ok":true}' }
            ],
            maxTokens: 200,
            temperature: 0
        });
        return { ok: true, model: r.model, content: r.content.slice(0, 60), usage: r.usage };
    } catch (e) {
        return { ok: false, error: e.message, type: e.type || 'unknown', status: e.status || 0 };
    }
}

module.exports = { chat, test, LlmError };
