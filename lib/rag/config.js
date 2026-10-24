/**
 * RAG 配置中心
 *
 * 复用现有 `settings` 表（key/value），不新建第二套配置库。
 * - 普通配置以明文 JSON 字符串存储；
 * - API Key 等敏感值使用 AES-256-GCM 加密后存储，主密钥来自环境变量 RAG_SECRET_KEY；
 * - 未配置主密钥时拒绝保存密钥，并在状态里明确提示需要部署配置。
 */
const crypto = require('node:crypto');
const db = require('../../database');

const SECRET_PREFIX = 'enc:v1:';

/** 逻辑默认值（任务书第十三节） */
const DEFAULTS = {
    'embedding.provider': 'siliconflow',
    'embedding.baseUrl': 'https://api.siliconflow.cn/v1',
    'embedding.model': 'BAAI/bge-m3',
    'embedding.dimension': 1024,
    'embedding.batchSize': 8,
    'embedding.maxCharsPerBatch': 8000,

    'llm.provider': 'deepseek',
    'llm.baseUrl': 'https://api.deepseek.com',
    'llm.model': 'deepseek-flash',
    // deepseek-flash 是推理模型：关闭思考可显著降低延迟与 token 开销
    'llm.disableThinking': true,

    'rag.chunkSize': 320,
    'rag.chunkOverlap': 60,
    'rag.vectorTopK': 50,
    'rag.ftsTopK': 50,
    'rag.rrfK': 60,
    'rag.finalChunkCount': 5,
    'rag.maxContextChars': 6000,
    'rag.maxOutputTokens': 700,

    'rag.conversationIdleTimeout': 1800,
    'rag.conversationMaxTurns': 6,
    'rag.logRetentionDays': 30,

    'rag.guestPerMinute': 3,
    'rag.guestPerDay': 30,
    'rag.userPerMinute': 6,
    'rag.userPerDay': 100,
    'rag.botPerMinute': 20,
    'rag.botPerDay': 500,
    'rag.maxQuestionLength': 500,
    'rag.maxConcurrent': 4,

    'rag.dailyBudget': 2,
    'rag.costAlertThreshold': 0.7,
    'rag.circuitBreaker': true,
    'rag.circuitFailThreshold': 5,
    'rag.circuitCooldownSeconds': 300,

    'rag.promptVersion': 'rag-prompt-v1',
    'rag.allowFtsOnlyFallback': false
};

/** 需要加密存储的键 */
const SECRET_KEYS = new Set(['embedding.apiKey', 'llm.apiKey']);

/** 允许普通管理员查看的键（其余仅超管可见可改） */
const PUBLIC_KEYS = new Set([
    'embedding.provider', 'embedding.baseUrl', 'embedding.model', 'embedding.dimension',
    'llm.provider', 'llm.baseUrl', 'llm.model',
    'rag.chunkSize', 'rag.chunkOverlap', 'rag.vectorTopK', 'rag.ftsTopK', 'rag.rrfK', 'rag.finalChunkCount',
    'rag.conversationIdleTimeout', 'rag.conversationMaxTurns', 'rag.logRetentionDays',
    'rag.guestPerMinute', 'rag.guestPerDay', 'rag.userPerMinute', 'rag.userPerDay',
    'rag.botPerMinute', 'rag.botPerDay', 'rag.maxQuestionLength', 'rag.maxConcurrent',
    'rag.dailyBudget', 'rag.costAlertThreshold', 'rag.circuitBreaker',
    'rag.circuitFailThreshold', 'rag.circuitCooldownSeconds',
    'rag.promptVersion', 'rag.allowFtsOnlyFallback'
]);

function masterKey() {
    const raw = process.env.RAG_SECRET_KEY;
    if (!raw || raw.length < 32) return null;
    return crypto.createHash('sha256').update('xuanjian-rag|' + raw).digest();
}

const hasMasterKey = () => !!masterKey();

function encrypt(plain) {
    const key = masterKey();
    if (!key) throw Object.assign(new Error('未配置 RAG_SECRET_KEY，无法保存密钥'), { status: 500 });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return SECRET_PREFIX + [iv, tag, data].map((b) => b.toString('base64url')).join(':');
}

function decrypt(stored) {
    const key = masterKey();
    if (!key || !stored || !String(stored).startsWith(SECRET_PREFIX)) return '';
    try {
        const [ivB, tagB, dataB] = String(stored).slice(SECRET_PREFIX.length).split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
        return '';
    }
}

/** 脱敏：只保留前 4 位与末 4 位 */
function maskSecret(v) {
    if (!v) return '';
    if (v.length <= 10) return '****';
    return v.slice(0, 4) + '****' + v.slice(-4);
}

async function readRow(key) {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', ['rag.' + key]);
    return row ? row.value : null;
}

async function writeRow(key, value) {
    await db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        ['rag.' + key, value]
    );
}

/** 读取单个配置（带类型还原） */
async function get(key) {
    const raw = await readRow(key);
    if (raw === null || raw === undefined || raw === '') {
        return DEFAULTS[key];
    }
    if (SECRET_KEYS.has(key)) {
        return decrypt(raw);
    }
    const def = DEFAULTS[key];
    if (typeof def === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : def;
    }
    if (typeof def === 'boolean') return raw === 'true' || raw === '1';
    return raw;
}

/** 批量读取，合并默认值 */
async function getAll() {
    const out = { ...DEFAULTS };
    const rows = await db.all("SELECT key, value FROM settings WHERE key LIKE 'rag.%'");
    for (const r of rows) {
        const key = r.key.slice(4);
        if (!(key in DEFAULTS)) continue;
        if (SECRET_KEYS.has(key)) continue; // 密钥单独处理，不随配置返回
        const def = DEFAULTS[key];
        if (typeof def === 'number') {
            const n = Number(r.value);
            out[key] = Number.isFinite(n) ? n : def;
        } else if (typeof def === 'boolean') {
            out[key] = r.value === 'true' || r.value === '1';
        } else {
            out[key] = r.value;
        }
    }
    return out;
}

/**
 * 写入配置。value 为空字符串/undefined 表示「不修改」（密钥尤其如此）。
 * 返回实际写入的键列表。
 */
async function setMany(patch) {
    const written = [];
    for (const [key, value] of Object.entries(patch || {})) {
        if (!(key in DEFAULTS)) continue;
        if (value === undefined || value === null || value === '') continue;

        if (SECRET_KEYS.has(key)) {
            const plain = String(value).trim();
            // 拒绝把脱敏字符串当成新密钥写回
            if (plain.includes('****')) continue;
            await writeRow(key, encrypt(plain));
            written.push(key);
            continue;
        }

        const def = DEFAULTS[key];
        let serialized;
        if (typeof def === 'number') {
            const n = Number(value);
            if (!Number.isFinite(n)) continue;
            serialized = String(n);
        } else if (typeof def === 'boolean') {
            serialized = value === true || value === 'true' || value === 1 ? 'true' : 'false';
        } else {
            serialized = String(value);
        }
        await writeRow(key, serialized);
        written.push(key);
    }
    return written;
}

/** 清空某个密钥（显式操作，避免「留空即清空」的误解） */
async function clearSecret(key) {
    if (!SECRET_KEYS.has(key)) return false;
    await db.run('DELETE FROM settings WHERE key = ?', ['rag.' + key]);
    return true;
}

/** 脱敏状态视图（管理端使用，绝不返回明文） */
async function secretStatus() {
    const out = {
        hasMasterKey: hasMasterKey(),
        embedding: { configured: false, masked: '', source: 'none' },
        llm: { configured: false, masked: '', source: 'none' }
    };
    for (const [slot, key] of [['embedding', 'embedding.apiKey'], ['llm', 'llm.apiKey']]) {
        const stored = await readRow(key);
        const plain = stored ? decrypt(stored) : '';
        if (plain) {
            out[slot] = { configured: true, masked: maskSecret(plain), source: 'db' };
        } else {
            const envVal = slot === 'embedding'
                ? (process.env.RAG_EMBEDDING_KEY || process.env.SILICONFLOW_API_KEY || '')
                : (process.env.RAG_LLM_KEY || process.env.DEEPSEEK_API_KEY || '');
            out[slot] = envVal
                ? { configured: true, masked: maskSecret(envVal), source: 'env' }
                : { configured: false, masked: '', source: 'none' };
        }
    }
    return out;
}

/** 实际取用的密钥：DB 加密值优先，其次环境变量 */
async function apiKey(slot) {
    const key = slot === 'embedding' ? 'embedding.apiKey' : 'llm.apiKey';
    const stored = await readRow(key);
    const plain = stored ? decrypt(stored) : '';
    if (plain) return plain;
    return slot === 'embedding'
        ? (process.env.RAG_EMBEDDING_KEY || process.env.SILICONFLOW_API_KEY || '')
        : (process.env.RAG_LLM_KEY || process.env.DEEPSEEK_API_KEY || '');
}

async function setMeta(key, value) {
    await db.run(
        `INSERT INTO rag_meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        [key, String(value)]
    );
}

async function getMeta(key, fallback = null) {
    const row = await db.get('SELECT value FROM rag_meta WHERE key = ?', [key]);
    return row ? row.value : fallback;
}

module.exports = {
    DEFAULTS,
    SECRET_KEYS,
    PUBLIC_KEYS,
    hasMasterKey,
    get,
    getAll,
    setMany,
    clearSecret,
    secretStatus,
    apiKey,
    encrypt,
    decrypt,
    maskSecret,
    setMeta,
    getMeta
};
