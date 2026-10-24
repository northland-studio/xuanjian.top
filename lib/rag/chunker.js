/**
 * Wiki 正文清洗与分块
 *
 * 设计要点（任务书 4.2）：
 *  - 保留标题层级、段落、列表、代码块、表格结构，不把表格单元格压成一句；
 *  - 去掉脚本/样式/图片地址/HTML 属性装饰；
 *  - {{member:x}} / {{generation:x}} 属于会随用户变化的卡片，转成稳定纯文本「成员：x」；
 *  - 按标题路径分块，目标 250~400 字，重叠 50~80 字；表格与代码块单独成块，尽量不截断；
 *  - 分块算法有版本号，便于判断旧索引是否失效。
 */
const crypto = require('node:crypto');

const CHUNKER_VERSION = 'v1';
const DEFAULT_CHUNK_SIZE = 320;
const DEFAULT_OVERLAP = 60;
const MAX_BLOCK_CHARS = 1500; // 表格/代码块超过此长度才拆分

const NAMED_ENTITIES = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–', middot: '·'
};

function decodeEntities(s) {
    return String(s || '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&([a-z#0-9]+);/gi, (m, name) => (NAMED_ENTITIES[name.toLowerCase()] !== undefined ? NAMED_ENTITIES[name.toLowerCase()] : m));
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '');

/** 短代码 → 稳定纯文本（不注入用户卡片信息） */
function normalizeShortcodes(html) {
    return String(html || '')
        .replace(/\{\{\s*member\s*:\s*([^}]+?)\s*\}\}/g, (_, v) => `（成员：${String(v).trim()}）`)
        .replace(/\{\{\s*generation\s*:\s*([^}]+?)\s*\}\}/g, (_, v) => `（代系：${String(v).trim()}）`)
        .replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (_, target, label) => label || target);
}

const cleanInline = (s) =>
    decodeEntities(stripTags(normalizeShortcodes(s)))
        .replace(/[ \t\u00a0]+/g, ' ')
        .trim();

/**
 * HTML → 结构化块
 * @returns {Array<{type:string, level?:number, text:string, rows?:string[][]}>}
 */
function htmlToBlocks(html) {
    let src = String(html || '');
    src = src.replace(/<!--[\s\S]*?-->/g, ' ');
    src = src.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    src = src.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    // 图片：只保留 alt 作为极简说明，绝不保留 URL
    src = src.replace(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi, ' （图：$1） ');
    src = src.replace(/<img\b[^>]*>/gi, ' ');
    // 软换行
    src = src.replace(/<br\s*\/?>/gi, '\n');

    const blocks = [];

    // 表格整体抽取（保留行列关系）
    const tableRe = /<table\b[\s\S]*?<\/table>/gi;
    const tables = [];
    src = src.replace(tableRe, (m) => {
        const idx = tables.length;
        tables.push(m);
        return `\n\n@@TABLE_${idx}@@\n\n`;
    });

    // 代码块整体抽取（保留原始换行与缩进）
    const codeRe = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
    const codes = [];
    src = src.replace(codeRe, (_, inner) => {
        const idx = codes.length;
        codes.push(decodeEntities(stripTags(inner)).replace(/^\n+|\n+$/g, ''));
        return `\n\n@@CODE_${idx}@@\n\n`;
    });

    // 标题 → 独立块；其余标签 → 分隔符
    src = src.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => `\n\n@@H${lvl}@@${cleanInline(inner)}\n\n`);
    src = src.replace(/<\/p>/gi, '\n\n');
    src = src.replace(/<li\b[^>]*>/gi, '\n- ');
    src = src.replace(/<\/li>/gi, '\n');
    src = src.replace(/<blockquote\b[^>]*>/gi, '\n\n@@QUOTE@@');
    src = src.replace(/<\/(ul|ol|blockquote|div|section|article|figure|figcaption)>/gi, '\n\n');

    const rawParts = src.split(/\n{2,}/);
    for (const rawPart of rawParts) {
        const part = rawPart.trim();
        if (!part) continue;

        const hMatch = /^@@H([1-6])@@([\s\S]*)$/.exec(part);
        if (hMatch) {
            const text = cleanInline(decodeEntities(hMatch[2]));
            if (text) blocks.push({ type: 'heading', level: Number(hMatch[1]), text });
            continue;
        }
        const tMatch = /^@@TABLE_(\d+)@@$/.exec(part);
        if (tMatch) {
            const tableHtml = tables[Number(tMatch[1])] || '';
            const rows = parseTable(tableHtml);
            if (rows.length) blocks.push({ type: 'table', text: tableToText(rows), rows });
            continue;
        }
        const cMatch = /^@@CODE_(\d+)@@$/.exec(part);
        if (cMatch) {
            const text = codes[Number(cMatch[1])] || '';
            if (text.trim()) blocks.push({ type: 'code', text: text.trim() });
            continue;
        }
        const isQuote = part.startsWith('@@QUOTE@@');
        const body = isQuote ? part.replace(/^@@QUOTE@@/, '') : part;
        const text = cleanInline(body).replace(/^-\s*/, '· ');
        if (!text) continue;
        if (isQuote) blocks.push({ type: 'quote', text });
        else if (/^·\s/.test(text)) blocks.push({ type: 'list', text });
        else blocks.push({ type: 'para', text });
    }

    return blocks;
}

function parseTable(tableHtml) {
    const rows = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr;
    while ((tr = trRe.exec(tableHtml))) {
        const cells = [];
        const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        let cell;
        while ((cell = cellRe.exec(tr[1]))) {
            cells.push(cleanInline(cell[2]));
        }
        if (cells.length) rows.push(cells);
    }
    // caption
    const cap = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(tableHtml);
    if (cap) rows.unshift([cleanInline(cap[1])]);
    return rows;
}

function tableToText(rows) {
    return rows.map((r) => r.join(' | ')).join('\n');
}

/** 内容 hash：用于判断 wiki 正文是否变化 */
function contentHash({ title, summary, content, categoryPath }) {
    return crypto
        .createHash('sha256')
        .update([title || '', summary || '', content || '', categoryPath || ''].join('\u0000'))
        .digest('hex');
}

/** 把超长表格/代码按行切成多块，避免整块超过限制 */
function splitLongBlock(block, maxChars) {
    if (block.text.length <= maxChars) return [block];
    const lines = block.text.split('\n');
    const out = [];
    let buf = [];
    let len = 0;
    for (const line of lines) {
        if (len + line.length + 1 > maxChars && buf.length) {
            out.push({ ...block, text: buf.join('\n') });
            buf = [];
            len = 0;
        }
        buf.push(line);
        len += line.length + 1;
    }
    if (buf.length) out.push({ ...block, text: buf.join('\n') });
    return out;
}

/**
 * 分块主函数
 * @param {{title:string, summary?:string, content:string, categoryPath?:string}} page
 * @param {{chunkSize?:number, overlap?:number}} opts
 * @returns {Array<{ordinal:number, headingPath:string, text:string, charLen:number}>}
 */
function chunkPage(page, opts = {}) {
    const chunkSize = Math.max(120, Number(opts.chunkSize) || DEFAULT_CHUNK_SIZE);
    const overlap = Math.max(0, Math.min(Number(opts.overlap) || DEFAULT_OVERLAP, Math.floor(chunkSize / 2)));
    const blocks = htmlToBlocks(page.content);

    const chunks = [];
    let headingStack = []; // [{level,text}]
    let buf = [];
    let bufLen = 0;
    let bufHeading = '';
    /** 刚落下的标题，等本节的第一个内容块一起成块，避免粘到上一节末尾 */
    let pendingHeading = '';

    const currentHeading = () => headingStack.map((h) => h.text).join(' / ');

    const flush = (carryOverlap = true) => {
        if (!buf.length) return;
        const text = buf.join('\n').trim();
        if (text) {
            chunks.push({
                ordinal: chunks.length,
                headingPath: bufHeading,
                text,
                charLen: text.length
            });
        }
        // 重叠：优先在行边界截取，避免把词/句切断
        if (carryOverlap && overlap > 0 && text.length > overlap) {
            const tail = text.slice(-overlap);
            const nl = tail.indexOf('\n');
            const cut = nl >= 0 && tail.length - nl > 20 ? tail.slice(nl + 1) : tail;
            buf = [cut];
            bufLen = cut.length;
        } else {
            buf = [];
            bufLen = 0;
        }
    };

    for (const rawBlock of blocks) {
        if (rawBlock.type === 'heading') {
            // 标题变化时结束当前块；不同章节之间不携带重叠，避免新块混入上一节内容
            flush(false);
            headingStack = headingStack.filter((h) => h.level < rawBlock.level);
            headingStack.push({ level: rawBlock.level, text: rawBlock.text });
            bufHeading = currentHeading();
            pendingHeading = rawBlock.text;
            continue;
        }

        // 表格 / 代码块：独立成块，尽量不与其他段落混在一起
        if (rawBlock.type === 'table' || rawBlock.type === 'code') {
            flush(false);
            const pieces = splitLongBlock(rawBlock, Math.max(chunkSize, 400));
            for (let i = 0; i < pieces.length; i++) {
                let text = pieces[i].text.trim();
                if (i === 0 && pendingHeading) {
                    text = pendingHeading + '\n' + text;
                    pendingHeading = '';
                }
                chunks.push({
                    ordinal: chunks.length,
                    headingPath: bufHeading,
                    text,
                    charLen: text.length
                });
            }
            buf = [];
            bufLen = 0;
            continue;
        }

        // 普通内容块：如果本节标题还没用掉，先并进缓冲区开头
        if (pendingHeading) {
            buf.push(pendingHeading);
            bufLen += pendingHeading.length + 1;
            pendingHeading = '';
        }

        const len = rawBlock.text.length;
        if (bufLen + len > chunkSize && buf.length) {
            flush();
            bufHeading = currentHeading();
        }
        buf.push(rawBlock.text);
        bufLen += len + 1;
    }
    flush();

    // 过滤过短碎片（合并进前一块）
    const merged = [];
    for (const c of chunks) {
        if (merged.length && c.charLen < 40) {
            const prev = merged[merged.length - 1];
            if (prev.charLen + c.charLen <= chunkSize + overlap) {
                prev.text = prev.text + '\n' + c.text;
                prev.charLen = prev.text.length;
                continue;
            }
        }
        merged.push(c);
    }
    merged.forEach((c, i) => (c.ordinal = i));

    return merged;
}

/** 生成用于 Embedding 的文本：把标题与分类作为一次性上下文，不重复堆叠 */
function buildEmbedText({ title, categoryPath, headingPath, text }) {
    const parts = [];
    if (title) parts.push('标题：' + title);
    if (categoryPath) parts.push('分类：' + categoryPath);
    if (headingPath) parts.push('章节：' + headingPath);
    parts.push(text);
    return parts.join('\n');
}

module.exports = {
    CHUNKER_VERSION,
    htmlToBlocks,
    chunkPage,
    buildEmbedText,
    contentHash,
    decodeEntities,
    cleanInline
};
