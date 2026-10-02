'use strict';

/**
 * 种子脚本：把《玄剑公会通史0517》(docx) 导入 Wiki
 * ============================================================================
 * 用法（在官网根目录执行）：
 *   node scripts/seed/history.js --dry-run          # 只解析，不写库、不上传
 *   node scripts/seed/history.js --no-images        # 不传图，正文里留占位 figure
 *   node scripts/seed/history.js --limit=2          # 只处理前 2 张图（联调用）
 *   node scripts/seed/history.js                    # 正式导入（18 页 + 全部图片）
 *
 * 也可以当模块用：
 *   const { seedHistory } = require('./scripts/seed/history');
 *   await seedHistory({ uploadImages: true, dryRun: false, log: console.log, imageLimit: 0 });
 *
 * 幂等性
 * ------
 *  - 分类：按 slug（lib/wiki 的中文拼音）查，存在则复用（必要时校正名称/父级/排序），不重复建。
 *  - 页面：按 title 查，存在则 updatePage（内容与分类都没变则完全跳过，不产生新 revision），
 *          不存在则 createPage。重复跑不会产生重复页面，也不会灌版本。
 *  - 图片：以「原图内容 sha1」为幂等键，缓存写在 data/wiki-seed-images.json（data/ 已 gitignore），
 *          命中缓存直接复用七牛 URL，不重复上传。
 *
 * 源文件
 * ------
 *  优先用已解压目录（HISTORY_DOCX_DIR 环境变量 / data/history-docx / 本地已知副本），
 *  都没有时再用 PowerShell Expand-Archive（Windows）或 unzip（Linux）把 .docx 解到临时目录。
 *
 * 抽取正文的两个坑
 * ----------------
 *  1) 取文本的正则必须写成 <w:t(?:\s[^>]*)?>；写成 <w:t[^>]*> 会把 <w:tab>/<w:tbl>/<w:tc> 一起吞掉。
 *  2) 目录（TOC）字段段落混在正文里，靠 w:instrText / TOC* 样式过滤掉。
 *
 * 已知取舍（更详细说明见交付说明）
 * ------------------------------
 *  - 文档内实际内嵌图片引用 156 处（唯一的 159 是 <a:blip[^>]*> 顺带匹配了 3 个 <a:blipFill>），
 *    全部落在 19 个页面里、一张不丢：14 章 + 序与跋 3 篇 + 结语 + 前置页「通史封面与编写信息」
 *    （前置页装封面区那 6 处引用 / 5 张唯一图）；去重后全书共 154 张源图。
 *  - 卷标题（第一卷/第二卷）不是页面，渲染成 <p class="wiki-volume-label">，避免污染前端按 h2 生成的 TOC。
 *  - 待上传占位图：lib/wiki 的白名单不含 figure 的 data-* 属性，所以占位 figure 同时带 class="wiki-pending-image"，
 *    保证消毒后仍能识别（data-pending-image="1" 会在入库时被 sanitize-html 丢弃）。
 *  - .env 兜底：本机 .env 第 12 行的注释吞掉了 QINIU_ACCESS_KEY（缺换行），dotenv 解析不到它；
 *    脚本会按原文宽松恢复并打警告。把 .env 那行拆成两行后，这段兜底就不会再触发。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

// lib/qiniu.js 是在 require 时读取 process.env 的，所以必须先加载 .env
// （quiet: 关掉 dotenv v17 的启动提示；已存在的环境变量不会被覆盖，DB_FILE 仍然生效）
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

/**
 * .env 兜底：项目根 .env 里七牛那段注释是 GBK 乱码且末尾丢了换行，
 * 变成 `# ...QINIU_ACCESS_KEY=vKzs...` —— dotenv 会把整行当注释，QINIU_SECRET_KEY 等其它键正常，
 * 只有 QINIU_ACCESS_KEY 解析不到（lib/qiniu.js 就会报「配置缺失」）。
 * 这里只对这一个小集合做一次宽松恢复（优先用真正的环境变量），并打印警告提醒修 .env。
 * 注意：必须在 require('../../lib/qiniu') 之前执行，因为它 require 时就固化了 process.env。
 */
const QINIU_ENV_RECOVER = ['QINIU_ACCESS_KEY'];
(function recoverQiniuEnv() {
    const missing = QINIU_ENV_RECOVER.filter(k => !process.env[k]);
    if (!missing.length) return;
    let raw = '';
    try { raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8'); } catch (e) { return; }
    for (const key of missing) {
        const m = new RegExp('(?:^|[^A-Za-z0-9_])' + key + '\\s*=\\s*([^\\s#]+)').exec(raw);
        if (!m) continue;
        process.env[key] = m[1];
        console.warn(`⚠ .env 里的 ${key} 被上一行注释吞掉了（缺少换行），已按原文宽松恢复；建议把 .env 第 12 行拆成两行。`);
    }
})();

const db = require('../../database');
const wiki = require('../../lib/wiki');
const qiniu = require('../../lib/qiniu');
const sharp = require('sharp');

/* ==================== 常量 ==================== */

const DOCX_REL_DEFAULT = '玄剑公会公会通史0517.docx';
const IMAGE_CACHE_FILE = path.join(ROOT, 'data', 'wiki-seed-images.json');
const IMAGE_KEY_PREFIX = 'wiki/history/';
const MAX_EDGE = 1600;              // 最长边
const JPEG_QUALITY = 80;
const EXPECTED_PAGES = 19;          // 14 章 + 序与跋 3 + 结语 + 前置页（封面图与编写信息）
const EXPECTED_CHAPTERS = 14;
const EXPECTED_FRONT_IMAGES = 6;    // 页面前置（封面）的图片引用数：6 处 / 5 张唯一图

const CATEGORY_ROOT = '公会历史';
const CATEGORY_MAIN = '通史正文';      // 14 章 + 结语
const CATEGORY_PREFACE = '序与跋';     // 前置页 / 纪年表 / 序 / 人物档案
const FRONT_PAGE_TITLE = '通史封面与编写信息';

const FOOTER_HTML = '<p><em>本文摘自《玄剑公会通史0517》（北域工作室编，玄剑公会高层校对），有修订请直接编辑本页。</em></p>';
const REVISION_NOTE = '种子导入：《玄剑公会通史0517》';

// summary 是否把正文开头的 h2 标题也算进去（false = 跳过标题，摘要更能说明内容）
const SUMMARY_INCLUDE_TITLE = false;

// 页面标题里要去掉的序数前缀
const TITLE_STRIP_RE = [
    /^第[一二三四五六七八九十百零〇\d]+章[\s、.．:：]*/,
    /^第[一二三四五六七八九十百零〇\d]+卷[\s、.．:：]*/,
    /^[一二三四五六七八九十]+[、.．]\s*/,
    /^附[\s、.．:：]+/
];

/* ==================== 小工具 ==================== */

function decodeXml(s) {
    return String(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&amp;/g, '&');
}

const escapeHtml = (s) => wiki.escapeHtml(s);

function sha1(buf) {
    return crypto.createHash('sha1').update(buf).digest('hex');
}

function humanMB(bytes) {
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function padRight(s, n) {
    // 中文按 2 列宽算，方便表格对齐
    const w = [...String(s)].reduce((a, c) => a + (/[\u2e80-\uffff]/.test(c) ? 2 : 1), 0);
    return String(s) + ' '.repeat(Math.max(0, n - w));
}

function stripTitlePrefix(text) {
    let t = String(text || '').trim();
    for (const re of TITLE_STRIP_RE) t = t.replace(re, '');
    return t.trim() || String(text || '').trim();
}

function countMatches(html, re) {
    const m = String(html).match(re);
    return m ? m.length : 0;
}

/* ==================== 源文件定位 ==================== */

function isDocxDir(p) {
    return !!p && fs.existsSync(path.join(p, 'word', 'document.xml'));
}

function extractDocx(docxPath, outDir, log) {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    if (process.platform === 'win32') {
        log(`  · 解压（PowerShell Expand-Archive）→ ${outDir}`);
        execFileSync('powershell', [
            '-NoProfile', '-NonInteractive', '-Command',
            `Expand-Archive -LiteralPath "${docxPath}" -DestinationPath "${outDir}" -Force`
        ], { stdio: 'inherit' });
    } else {
        log(`  · 解压（unzip）→ ${outDir}`);
        execFileSync('unzip', ['-o', '-q', docxPath, '-d', outDir], { stdio: 'inherit' });
    }
    if (!isDocxDir(outDir)) throw new Error('解压后仍找不到 word/document.xml：' + outDir);
}

/** 返回已解压目录（必要时自动解压） */
function resolveDocxDir({ docxDir, docxPath, log }) {
    const dirCandidates = [
        docxDir,
        process.env.HISTORY_DOCX_DIR,
        path.join(ROOT, 'data', 'history-docx'),
        'H:\\chengxuyuanma\\_docx\\x'
    ].filter(Boolean);
    for (const c of dirCandidates) {
        if (isDocxDir(c)) return c;
    }

    const fileCandidates = [
        docxPath,
        process.env.HISTORY_DOCX,
        'H:\\chengxuyuanma\\' + DOCX_REL_DEFAULT,
        path.join(ROOT, 'data', DOCX_REL_DEFAULT)
    ].filter(Boolean);
    const file = fileCandidates.find(p => fs.existsSync(p));
    if (!file) {
        throw new Error(
            '找不到通史源文件。请用 HISTORY_DOCX_DIR 指向已解压目录（含 word/document.xml），' +
            '或把 docx 放到 data/ 下并设置 HISTORY_DOCX。已尝试：\n  ' +
            dirCandidates.concat(fileCandidates).join('\n  ')
        );
    }
    const out = path.join(os.tmpdir(), 'xuanjian-history-docx');
    log(`未找到已解压副本，自动解压：${file}`);
    extractDocx(file, out, log);
    return out;
}

/* ==================== docx 解析 ==================== */

const TAG_RE = /<(\/?)([A-Za-z0-9_:]+)((?:"[^"]*"|[^>"])*?)(\/?)>/g;

/**
 * 把 document.xml 解析成「块」序列（段落 / 表格），保持文档顺序。
 * 每个块：{ kind:'p'|'tbl', style, field, parts:[{type:'text'|'image'|'link', ...}], raw }
 *  - parts 保持块内顺序，图片和文字不会错位
 *  - 图片：part = { type:'image', rId }
 *  - 外链：part = { type:'text', text, href }（<w:hyperlink r:id>）
 */
function parseDocumentXml(xml) {
    const blocks = [];
    let tblDepth = 0;
    let pDepth = 0;
    let cur = null;
    let tblStart = 0;
    let linkStack = [];
    let m;

    const textOf = (b) => b.parts.filter(p => p.type === 'text').map(p => p.text).join('');

    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(xml))) {
        const [full, close, name, attrs, selfClose] = m;

        if (close === '/') {
            if (name === 'w:hyperlink') { linkStack.pop(); continue; }
            if (name === 'w:tbl') {
                tblDepth -= 1;
                if (tblDepth === 0 && cur) { cur.raw = xml.slice(tblStart, m.index + full.length); blocks.push(cur); cur = null; }
                continue;
            }
            if (name === 'w:p') {
                // 表格单元格里的段落由表格解析负责，不能在这里收尾（否则整张表会在第一个单元格处被截断）
                if (tblDepth > 0) continue;
                if (pDepth > 0) pDepth -= 1;
                if (pDepth === 0 && cur) { cur.raw = xml.slice(cur.start, m.index + full.length); blocks.push(cur); cur = null; }
                continue;
            }
            continue;
        }

        if (name === 'w:tbl') {
            if (tblDepth === 0 && !cur) {
                cur = { kind: 'tbl', style: '', field: false, parts: [], start: m.index, raw: '' };
                tblStart = m.index;
            }
            if (!selfClose) tblDepth += 1;
            continue;
        }

        if (name === 'w:p') {
            if (selfClose || tblDepth > 0) continue;   // 表格里的段落不算正文块
            if (pDepth === 0 && !cur) {
                cur = { kind: 'p', style: '', field: false, parts: [], start: m.index, raw: '' };
            }
            pDepth += 1;
            continue;
        }

        if (name === 'w:hyperlink') {
            const rid = /r:id="([^"]*)"/.exec(attrs);
            linkStack.push(rid ? rid[1] : null);
            continue;
        }

        if (!cur) continue;
        if (cur.kind === 'tbl') continue;   // 表格内部的内容交给 parseTableRows 处理

        if (name === 'w:pStyle') {
            const v = /w:val="([^"]*)"/.exec(attrs);
            if (v && !cur.style) cur.style = v[1];
            continue;
        }
        if (name === 'w:instrText' || name === 'w:fldSimple' || name === 'w:fldChar') { cur.field = true; continue; }
        if (name === 'w:br' || name === 'w:cr') { cur.parts.push({ type: 'text', text: '\n', href: null }); continue; }
        if (name === 'w:tab') { cur.parts.push({ type: 'text', text: ' ', href: null }); continue; }
        if (name === 'w:t') {
            const end = xml.indexOf('</w:t>', m.index);
            if (end > 0) {
                const raw = xml.slice(m.index + full.length, end);
                cur.parts.push({
                    type: 'text',
                    text: decodeXml(raw),
                    href: linkStack.length ? linkStack[linkStack.length - 1] : null
                });
                TAG_RE.lastIndex = end;
            }
            continue;
        }
        if (name === 'a:blip') {
            const v = /r:embed="([^"]*)"/.exec(attrs) || /r:link="([^"]*)"/.exec(attrs);
            if (v) cur.parts.push({ type: 'image', rId: v[1] });
            continue;
        }
        if (name === 'v:imagedata') {
            const v = /r:id="([^"]*)"/.exec(attrs);
            if (v) cur.parts.push({ type: 'image', rId: v[1] });
            continue;
        }
    }

    // 归一化：块文本（用于标题判定）。rawText 保留原始空格 —— 编写信息是靠空格对齐的，折叠后就分不出栏目
    for (const b of blocks) {
        const raw = (b.kind === 'tbl' ? tablePlainText(b.raw) : textOf(b)).trim();
        b.rawText = raw;
        b.text = raw.replace(/[ \t]+/g, ' ').trim();
    }
    return blocks;
}

/** 表格 → 行列（[{ text, colspan }]） */
function parseTableRows(rawXml) {
    const rows = [];
    const trRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
    let m;
    while ((m = trRe.exec(rawXml))) {
        const cells = [];
        const tcRe = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
        let c;
        while ((c = tcRe.exec(m[1]))) {
            const lines = [];
            const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
            let p;
            while ((p = pRe.exec(c[1]))) {
                const t = [...p[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
                    .map(x => decodeXml(x[1])).join('').trim();
                if (t) lines.push(t);
            }
            const gs = /<w:gridSpan w:val="(\d+)"/.exec(c[1]);
            cells.push({ lines, colspan: gs ? Number(gs[1]) : 1 });
        }
        if (cells.length) rows.push(cells);
    }
    return rows;
}

function tablePlainText(rawXml) {
    return [...String(rawXml).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map(m => decodeXml(m[1])).join(' ').replace(/\s+/g, ' ').trim();
}

/* ==================== 前置页：编写信息 ==================== */

/**
 * 「编写信息」是按空格对齐的伪表格（如「主    编    Morzane123」），没有真 w:tbl。
 * 解析规则：
 *  1) Copyright / © 开头的行 → 归到 Copyright 行（多行合并）
 *  2) 行首是「中文栏目名（中间可能有对齐空格）+ 2 个以上空格 + 内容」→ 新的一行
 *  3) 其余非空行 → 续行（如「编委」的第二个名字行），接到上一行末尾；若还没有任何行，则作为表前段落
 * 返回 { rows:[{label,value}], before:[string] }
 */
const INFO_LABEL_RE = /^([\u4e00-\u9fa5]+(?:\s+[\u4e00-\u9fa5]+)*)\s{2,}(\S[\s\S]*)$/;

function parseInfoSection(texts) {
    const squeeze = (s) => String(s).replace(/\s{2,}/g, ' ').trim();
    const rows = [];
    const before = [];
    for (const raw of texts) {
        const t = String(raw).replace(/\s+$/, '').trim();
        if (!t) continue;
        if (/^(Copyright|©)/i.test(t)) {
            const last = rows[rows.length - 1];
            if (last && last.label === 'Copyright') last.value = squeeze(last.value + ' ' + t);
            else rows.push({ label: 'Copyright', value: squeeze(t) });
            continue;
        }
        const m = INFO_LABEL_RE.exec(t);
        if (m) {
            rows.push({ label: m[1].replace(/\s+/g, ''), value: squeeze(m[2]) });
            continue;
        }
        if (rows.length) rows[rows.length - 1].value = squeeze(rows[rows.length - 1].value + ' ' + t);
        else before.push(squeeze(t));
    }
    return { rows, before };
}

/* ==================== 页面模型 ==================== */

/**
 * 把块序列切成 18 个页面模型。
 *  - 页面起点：样式 af4（玄剑历史副标题，17 个：序与跋 3 + 14 章）或样式 2（附 来自玄剑创始人的结语）
 *  - 目录字段段落（w:instrText / TOC* 样式）一律跳过
 *  - 「卷」标题（Title 样式）不是页面，缓存起来挂到紧跟其后的那一页开头
 */
function buildPageModels(blocks, relMap, log = () => {}) {
    const isField = (b) => b.field || /^TOC/i.test(b.style || '');
    const isVolume = (b) => b.style === 'ac';
    const isPageStart = (b) => b.kind === 'p' && (b.style === 'af4' || b.style === '2');

    let skippedField = 0;
    for (const b of blocks) if (isField(b) && b.text) skippedField += 1;

    const startIdx = blocks.findIndex(b => isPageStart(b) || isVolume(b));
    if (startIdx < 0) throw new Error('没找到任何页面起点（样式 af4 / 2），文档结构可能变了');

    const pages = [];
    let pendingVolumes = [];

    for (let i = startIdx; i < blocks.length; i += 1) {
        const b = blocks[i];
        if (isField(b)) continue;

        if (isPageStart(b)) {
            const title = stripTitlePrefix(b.text);
            pages.push({
                title,
                rawTitle: b.text,
                category: null,
                parts: pendingVolumes.concat([{ type: 'heading', level: 2, text: title }]),
                blocks: 0
            });
            pendingVolumes = [];
            continue;
        }

        if (isVolume(b)) {
            pendingVolumes.push({ type: 'volume', text: b.text });
            continue;
        }

        if (pages.length === 0) continue;   // 页面起点之前的内容（理论上没有）

        const page = pages[pages.length - 1];
        page.blocks += 1;

        if (b.kind === 'tbl') {
            page.parts.push({ type: 'table', rows: parseTableRows(b.raw), raw: b.raw });
            // 表格里的图片暂不支持放进单元格：退化为紧随表格输出，并提示（本文件当前表格内无图）
            const tblImgs = [...b.raw.matchAll(/<a:blip\s[^>]*r:embed="([^"]+)"/g)].map(x => x[1]);
            if (tblImgs.length) {
                log(`⚠ 表格内发现 ${tblImgs.length} 张图片，已退化为排在表格之后输出`);
                for (const rId of tblImgs) {
                    page.parts.push({ type: 'image', rId, mediaFile: relMap[rId] || null });
                }
            }
            continue;
        }

        // 段落：文字 + 图片按块内顺序输出；样式 14 = 小节标题（outlineLvl=2）
        const hasImage = b.parts.some(p => p.type === 'image');
        const isSubHeading = b.style === '14' && !!b.text && !hasImage;
        const para = [];
        const flushText = () => {
            if (!para.length) return;
            const text = para.join('');
            para.length = 0;
            page.parts.push(isSubHeading
                ? { type: 'heading', level: 3, text: text.trim() }
                : { type: 'text', text });
        };
        for (const part of b.parts) {
            if (part.type === 'image') {
                flushText();
                page.parts.push({ type: 'image', rId: part.rId, mediaFile: relMap[part.rId] || null });
            } else if (part.type === 'text') {
                para.push(part.text);
            }
        }
        flushText();
    }

    if (pendingVolumes.length) {
        log(`⚠ 文末有 ${pendingVolumes.length} 个卷标题没有后续页面，已忽略：` + pendingVolumes.map(v => v.text).join('、'));
    }

    /* ---- 前置页（封面图 + 编写信息）：把页面起点之前的封面图全部收进第 19 页，保证不丢图 ---- */
    const frontImgs = [];
    const infoTexts = [];
    let coverTextLines = 0;
    let inInfo = false;
    for (let i = 0; i < startIdx; i += 1) {
        const b = blocks[i];
        if (isField(b)) break;                        // 走到目录就结束（目录之后没有前置内容）
        if (b.kind === 'p') {
            for (const part of b.parts) if (part.type === 'image') frontImgs.push(part.rId);
        }
        if (b.kind === 'p' && b.style === 'af8') {     // 「玄剑公会通史：编写信息」小节标题
            inInfo = true;
            infoTexts.push({ heading: true, text: b.rawText || b.text });
            continue;
        }
        if (!b.rawText) continue;
        if (inInfo) infoTexts.push({ heading: false, text: b.rawText });
        else coverTextLines += 1;                      // 封面说明/献辞/出品等纯封面文字（不纳入本页）
    }
    const info = parseInfoSection(infoTexts.filter(t => !t.heading).map(t => t.text));
    const infoHeading = (infoTexts.find(t => t.heading) || {}).text || '编写信息';

    const frontPage = {
        title: FRONT_PAGE_TITLE,
        rawTitle: infoHeading,
        category: CATEGORY_PREFACE,
        blocks: frontImgs.length + infoTexts.length,
        parts: [{ type: 'heading', level: 2, text: FRONT_PAGE_TITLE }]
    };
    for (const rId of frontImgs) {
        frontPage.parts.push({ type: 'image', rId, mediaFile: relMap[rId] || null });
    }
    frontPage.parts.push({ type: 'heading', level: 3, text: infoHeading.replace(/^玄剑公会通史[：:]\s*/, '') });
    for (const t of info.before) frontPage.parts.push({ type: 'text', text: t });
    if (info.rows.length) frontPage.parts.push({ type: 'kv', rows: info.rows });
    frontPage.skippedCoverLines = coverTextLines;

    if (frontImgs.length) pages.unshift(frontPage);
    else log('⚠ 前置部分没解析到封面图，未生成「' + FRONT_PAGE_TITLE + '」页');

    // 分类归属：序与跋 4 篇 vs 通史正文（14 章 + 结语）
    const PREFACE_KEYS = ['纪年表', '序与玄剑史诗', '人员的档案'];
    for (const p of pages) {
        if (!p.category) {
            p.category = PREFACE_KEYS.some(k => p.title.includes(k)) ? CATEGORY_PREFACE : CATEGORY_MAIN;
        }
    }

    const chapters = pages.filter(p => p.category === CATEGORY_MAIN && !/结语/.test(p.title)).length;
    if (chapters !== EXPECTED_CHAPTERS) {
        log(`⚠ 识别到 ${chapters} 章（预期 ${EXPECTED_CHAPTERS}），请检查标题解析`);
    }
    log(`解析：块 ${blocks.length} 个 → 页面 ${pages.length} 个（跳过目录字段段落 ${skippedField} 个）`);
    log(`  前置页「${FRONT_PAGE_TITLE}」：封面图 ${frontImgs.length} 处引用 + 编写信息 ${info.rows.length} 行` +
        `（另有 ${coverTextLines} 个纯封面文字段落未纳入）`);
    return pages;
}

/* ==================== HTML 渲染 ==================== */

function renderTable(rows) {
    if (!rows || rows.length < 2) return null;
    const cell = (c, tag) => {
        const inner = c.lines.map(escapeHtml).join('<br>');
        const span = c.colspan > 1 ? ` colspan="${c.colspan}"` : '';
        return `<${tag}${span}>${inner}</${tag}>`;
    };
    const head = '<thead><tr>' + rows[0].map(c => cell(c, 'th')).join('') + '</tr></thead>';
    const body = rows.length > 1
        ? '<tbody>' + rows.slice(1).map(r => '<tr>' + r.map(c => cell(c, 'td')).join('') + '</tr>').join('') + '</tbody>'
        : '';
    return `<table>${head}${body}</table>`;
}

const URL_RE = /(https?:\/\/[^\s<>"'）】]+)/g;

/** 转义后把裸 URL 变成外链（只用于编写信息里的「官网」等） */
function linkify(text) {
    return escapeHtml(text).replace(URL_RE, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

/** 编写信息键值表：每行一个栏目 */
function renderInfoTable(rows) {
    const body = rows
        .map(r => `<tr><th>${escapeHtml(r.label)}</th><td>${linkify(r.value)}</td></tr>`)
        .join('');
    return `<table><tbody>${body}</tbody></table>`;
}

function figureHtml(url, alt, pendingFile) {
    if (url) {
        return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy"></figure>`;
    }
    return `<figure class="wiki-pending-image" data-pending-image="1">` +
        `<figcaption>${escapeHtml(alt)}${pendingFile ? '（待上传：' + escapeHtml(pendingFile) + '）' : '（图片待上传）'}</figcaption>` +
        `</figure>`;
}

const CAPTION_RE = /^图\s*[\d一二三四五六七八九十]+\s*[-–—－.]?\s*\d*\s*[:：]?/;

/** 页面纯文本（摘要/字数）：heading / volume / 正文 / 表格文字依次拼接，忽略图片占位说明 */
function pageText(page, { skipTitleAndVolume = false } = {}) {
    return page.parts
        .filter(p => !(skipTitleAndVolume && ((p.type === 'heading' && p.level === 2) || p.type === 'volume')))
        .map(p => {
            if (p.type === 'text' || p.type === 'heading' || p.type === 'volume') return p.text;
            if (p.type === 'table') return tablePlainText(p.raw);
            if (p.type === 'kv') return p.rows.map(r => `${r.label} ${r.value}`).join(' ');
            return '';
        })
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 渲染一个页面。urlOf(part) 返回图片 URL 或 null（null = 待上传占位）。
 * 返回 { html, text, imgCount, figureCount, pendingCount, imageCount }
 */
function renderPageModel(page, urlOf, indexOf) {
    const body = [];
    let lastText = '';
    let imgCount = 0;
    let figureCount = 0;
    let pendingCount = 0;
    let imageCount = 0;

    for (const part of page.parts) {
        if (part.type === 'heading') {
            body.push(`<h${part.level}>${escapeHtml(part.text)}</h${part.level}>`);
            lastText = part.text;
        } else if (part.type === 'volume') {
            body.push(`<p class="wiki-volume-label"><strong>${escapeHtml(part.text)}</strong></p>`);
            lastText = part.text;
        } else if (part.type === 'table') {
            const html = renderTable(part.rows);
            if (html) {
                body.push(html);
            } else {
                // 退化：表格里每段文字单独成段
                const lines = tablePlainText(part.raw).split(/\s{2,}/).filter(Boolean);
                for (const l of lines) body.push(`<p>${escapeHtml(l)}</p>`);
            }
        } else if (part.type === 'kv') {
            body.push(renderInfoTable(part.rows));
        } else if (part.type === 'text') {
            const t = part.text.trim();
            if (!t) continue;
            body.push('<p>' + t.split('\n').map(escapeHtml).join('<br>') + '</p>');
            lastText = t;
        } else if (part.type === 'image') {
            imageCount += 1;
            figureCount += 1;
            const url = urlOf(part);
            const file = path.basename(part.mediaFile || '');
            const alt = CAPTION_RE.test(lastText) ? lastText.slice(0, 120) : `玄剑公会通史插图 ${indexOf(part)}`;
            if (url) { imgCount += 1; body.push(figureHtml(url, alt, '')); }
            else { pendingCount += 1; body.push(figureHtml(null, alt, file)); }
        }
    }

    const inner = body.join('\n');
    return {
        html: inner + '\n' + FOOTER_HTML,
        text: pageText(page),
        imgCount, figureCount, pendingCount, imageCount
    };
}

/* ==================== 图片：压缩 + 上传 ==================== */

function loadImageCache(log) {
    try {
        if (!fs.existsSync(IMAGE_CACHE_FILE)) return { version: 1, images: {} };
        const j = JSON.parse(fs.readFileSync(IMAGE_CACHE_FILE, 'utf8'));
        if (!j || typeof j !== 'object' || typeof j.images !== 'object' || !j.images) {
            log('⚠ 图片缓存结构异常，按空缓存处理');
            return { version: 1, images: {} };
        }
        return { version: 1, generatedAt: j.generatedAt, images: j.images };
    } catch (e) {
        log(`⚠ 图片缓存读取失败（将重建）：${e.message}`);
        return { version: 1, images: {} };
    }
}

function saveImageCache(cache, log) {
    try {
        fs.mkdirSync(path.dirname(IMAGE_CACHE_FILE), { recursive: true });
        const keys = Object.keys(cache.images).sort();
        const sorted = {};
        for (const k of keys) sorted[k] = cache.images[k];
        const out = { version: 1, generatedAt: new Date().toISOString(), images: sorted };
        fs.writeFileSync(IMAGE_CACHE_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
        log(`图片缓存已写入 ${path.relative(ROOT, IMAGE_CACHE_FILE)}（${keys.length} 条）`);
    } catch (e) {
        log(`⚠ 图片缓存写入失败：${e.message}`);
    }
}

/** 压缩：最长边 ≤1600；带 alpha 的保留 png，其余转 jpeg(q80) */
async function compressImage(srcPath) {
    const meta = await sharp(srcPath).metadata();
    const keepAlpha = meta.hasAlpha === true;
    let pipe = sharp(srcPath).rotate();
    if ((meta.width || 0) > MAX_EDGE || (meta.height || 0) > MAX_EDGE) {
        pipe = pipe.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
    }
    if (keepAlpha) {
        const { data, info } = await pipe.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
        return { buffer: data, ext: 'png', format: 'png', width: info.width, height: info.height };
    }
    const { data, info } = await pipe.jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
        .toBuffer({ resolveWithObject: true });
    return { buffer: data, ext: 'jpg', format: 'jpeg', width: info.width, height: info.height };
}

/** 上传到七牛（表单直传，Node 20 自带 fetch/FormData/Blob） */
async function uploadBuffer(key, buffer) {
    const token = qiniu.generateUploadToken(key, Math.max(5 * 1024 * 1024, buffer.length + 512 * 1024));
    const form = new FormData();
    form.append('token', token);
    form.append('key', key);
    form.append('file', new Blob([buffer]), path.basename(key));
    const res = await fetch(qiniu.QINIU_UPLOAD_URL, { method: 'POST', body: form });
    const text = await res.text();
    if (!res.ok) throw new Error(`七牛上传失败 HTTP ${res.status}：${text.slice(0, 300)}`);
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* 有些区域返回纯文本 */ }
    if (data && data.error) throw new Error('七牛上传失败：' + data.error);
    return data || { key };
}

function domainUrl(key) {
    return String(qiniu.QINIU_DOMAIN || '').replace(/\/+$/, '') + '/' + key;
}

/* ==================== 数据库：分类 / 页面 ==================== */

async function resolveAuthor(log) {
    const row = await db.get(
        'SELECT id, username, nickname, level FROM users WHERE level >= 2 ORDER BY id ASC LIMIT 1'
    );
    if (!row) {
        throw new Error('users 表里找不到 level >= 2 的账号，无法确定页面作者；请先创建管理员账号（或调整脚本里的 level 阈值）');
    }
    log(`作者账号：#${row.id} ${row.username}（${row.nickname || '-'}，level=${row.level}）`);
    return row;
}

async function ensureCategory({ name, parentId = null, sortOrder = 0, description = '' }, userId, log) {
    const slug = wiki.slugify(name);
    let existing = await db.get('SELECT * FROM wiki_categories WHERE slug = ?', [slug]);
    if (!existing) {
        existing = await db.get('SELECT * FROM wiki_categories WHERE name = ? AND parent_id IS ?', [name, parentId]);
    }
    if (existing) {
        const needFix = existing.name !== name
            || (existing.parent_id || null) !== (parentId || null)
            || existing.sort_order !== sortOrder
            || !existing.is_active;
        if (needFix) {
            await wiki.updateCategory(existing.id, {
                name, parent_id: parentId, sort_order: sortOrder, is_active: true,
                description: existing.description || description
            });
            log(`  分类「${name}」已存在（#${existing.id}），已校正父级/排序`);
        }
        return { id: existing.id, created: false };
    }
    const cat = await wiki.createCategory(
        { name, slug, parent_id: parentId, sort_order: sortOrder, description, is_active: true },
        userId
    );
    log(`  分类「${name}」创建（#${cat.id} slug=${cat.slug}）`);
    return { id: cat.id, created: true };
}

async function upsertPage({ title, html, summary, categoryId }, authorId, log) {
    const existing = await db.get(
        'SELECT id, content, category_id, status FROM wiki_pages WHERE title = ?', [title]
    );
    if (existing) {
        if (existing.content === html
            && Number(existing.category_id) === Number(categoryId)
            && existing.status === 'published') {
            return { id: existing.id, action: 'unchanged' };
        }
        const p = await wiki.updatePage(existing.id, {
            title, content: html, summary, category_id: categoryId, status: 'published'
        }, authorId, REVISION_NOTE);
        return { id: p.id, action: 'updated' };
    }
    const p = await wiki.createPage({
        title, content: html, summary, category_id: categoryId, status: 'published'
    }, authorId);
    return { id: p.id, action: 'created' };
}

/* ==================== 主流程 ==================== */

/**
 * @param {object}   opts
 * @param {boolean}  opts.uploadImages  是否压缩并上传图片（false = 全部留占位）
 * @param {boolean}  opts.dryRun        true = 不写库、不上传，只打印计划
 * @param {Function} opts.log           日志函数
 * @param {number}   opts.imageLimit    >0 时只处理文档顺序前 N 张图（其余占位），0 = 不限
 */
async function seedHistory({ uploadImages = true, dryRun = false, log = console.log, imageLimit = 0 } = {}) {
    const t0 = Date.now();
    const limit = Number(imageLimit) > 0 ? Number(imageLimit) : 0;

    log('=== 玄剑公会通史 → Wiki 种子导入 ===');
    log(`模式：${dryRun ? 'dryRun（不写库/不上传）' : '正式'} · 图片：${uploadImages ? (limit ? `只处理前 ${limit} 张` : '全部上传') : '跳过上传（留占位）'}`);

    /* 1) 找源文件 + 解析 */
    const dir = resolveDocxDir({ log });
    log(`源目录：${dir}`);
    const docXmlPath = path.join(dir, 'word', 'document.xml');
    const relsPath = path.join(dir, 'word', '_rels', 'document.xml.rels');
    const mediaDir = path.join(dir, 'word', 'media');
    const xml = fs.readFileSync(docXmlPath, 'utf8');
    const relsXml = fs.readFileSync(relsPath, 'utf8');

    const relMap = {};
    for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
        relMap[m[1]] = m[2];
    }
    const mediaFileOf = (rId) => {
        const t = relMap[rId];
        if (!t) return null;
        return path.join(mediaDir, path.basename(t));
    };

    const blocks = parseDocumentXml(xml);
    const pages = buildPageModels(blocks, relMap, log);

    /* 2) 统计图片引用（全文档 vs 页内） */
    const allRefs = [];
    for (const b of blocks) {
        if (b.kind !== 'p') continue;
        for (const p of b.parts) if (p.type === 'image') allRefs.push(p.rId);
    }
    const inPageRefs = [];
    for (const page of pages) {
        for (const p of page.parts) {
            if (p.type !== 'image') continue;
            p.mediaPath = mediaFileOf(p.rId);
            if (!p.mediaPath || !fs.existsSync(p.mediaPath)) {
                throw new Error(`图片关系缺失：${p.rId} → ${p.mediaFile || '?'}`);
            }
            inPageRefs.push(p);
        }
    }

    /* 3) 去重 + 计算 sha1（按文档首次出现顺序） */
    const byHash = new Map();     // sha1 → plan 项
    const plan = [];              // 文档顺序的唯一图片
    for (const part of inPageRefs) {
        const buf = fs.readFileSync(part.mediaPath);
        const hash = sha1(buf);
        part.hash = hash;
        if (byHash.has(hash)) { byHash.get(hash).refs.push(part); continue; }
        const item = {
            hash,
            mediaFile: path.basename(part.mediaPath),
            mediaPath: part.mediaPath,
            bytes: buf.length,
            refs: [part]
        };
        byHash.set(hash, item);
        plan.push(item);
    }

    const cache = loadImageCache(log);
    const cacheHits = plan.filter(i => cache.images[i.hash] && cache.images[i.hash].url);
    const toUpload = plan.filter(i => !(cache.images[i.hash] && cache.images[i.hash].url));
    const plannedBytes = toUpload.reduce((a, i) => a + i.bytes, 0);

    // 前置页（封面图）单独统计
    const frontRefs = (pages[0] && pages[0].title === FRONT_PAGE_TITLE ? pages[0].parts : [])
        .filter(p => p.type === 'image');
    const frontHashes = new Set(frontRefs.map(p => p.hash));
    const frontPlan = plan.filter(i => frontHashes.has(i.hash));
    const frontToUpload = frontPlan.filter(i => !(cache.images[i.hash] && cache.images[i.hash].url));
    const frontBytes = frontToUpload.reduce((a, i) => a + i.bytes, 0);
    const excluded = allRefs.length - inPageRefs.length;

    log('');
    log(`内嵌图片：文档内 ${allRefs.length} 处引用 → ${pages.length} 页内 ${inPageRefs.length} 处（去重后 ${plan.length} 张源图）` +
        (excluded ? `；仍有 ${excluded} 处未纳入页面` : '；已全部纳入页面（不丢图）'));
    log(`前置图（${FRONT_PAGE_TITLE}）：${frontRefs.length} 处引用 / 去重 ${frontPlan.length} 张 · ` +
        (uploadImages ? `计划上传 ${frontToUpload.length} 张，总计 ${humanMB(frontBytes)}（原始体积）`
            : `${frontPlan.length} 张全部占位（原始体积 ${humanMB(frontPlan.reduce((a, i) => a + i.bytes, 0))}）`));
    if (!uploadImages) {
        log(`图片计划：跳过上传，${plan.length} 张源图全部保留占位（原始体积 ${humanMB(plan.reduce((a, i) => a + i.bytes, 0))}，未计入缓存）`);
    } else if (dryRun) {
        log(`图片计划：计划上传 ${toUpload.length} 张，总计 ${humanMB(plannedBytes)}（原始体积；缓存命中复用 ${cacheHits.length} 张，dryRun 不压缩不上传）`);
    } else {
        log(`图片计划：需上传 ${toUpload.length} 张（缓存命中复用 ${cacheHits.length} 张），原始体积 ${humanMB(plannedBytes)}`);
        if (toUpload.length) log('开始压缩并上传七牛……');
    }

    /* 4) 逐张压缩上传（按需） */
    const urlByHash = new Map();
    let uploaded = 0;
    let uploadBytes = 0;
    let cacheDirty = false;

    for (let i = 0; i < plan.length; i += 1) {
        const item = plan[i];
        const cached = cache.images[item.hash];
        const allowed = !limit || i < limit;

        if (!allowed) continue;

        if (cached && cached.url) {
            urlByHash.set(item.hash, cached.url);
            continue;
        }
        if (!uploadImages || dryRun) continue;

        const out = await compressImage(item.mediaPath);
        const key = `${IMAGE_KEY_PREFIX}${item.hash.slice(0, 16)}.${out.ext}`;
        await uploadBuffer(key, out.buffer);
        const url = domainUrl(key);
        urlByHash.set(item.hash, url);
        cache.images[item.hash] = {
            key, url,
            source: 'word/media/' + item.mediaFile,
            format: out.format,
            width: out.width,
            height: out.height,
            bytes: out.buffer.length,
            originalBytes: item.bytes,
            uploadedAt: new Date().toISOString()
        };
        cacheDirty = true;
        uploaded += 1;
        uploadBytes += out.buffer.length;
        log(`  [${uploaded}/${limit ? Math.min(limit, plan.length) : plan.length}] ${key} ` +
            `${(out.buffer.length / 1024).toFixed(0)}KB ← ${item.mediaFile} ` +
            `(${Math.round(item.bytes / 1024)}KB, ${out.width}x${out.height})`);
    }

    if (cacheDirty && !dryRun) saveImageCache(cache, log);

    const urlOf = (part) => urlByHash.get(part.hash) || null;
    const imgIndex = new Map();
    inPageRefs.forEach((p, i) => imgIndex.set(p, i + 1));
    const indexOf = (part) => imgIndex.get(part) || 0;

    /* 5) 渲染 + 消毒预览（sanitizeContent 与 createPage 完全一致，保证检查的就是入库内容） */
    const rendered = [];
    const sanitizeWarnings = [];
    for (const page of pages) {
        const r = renderPageModel(page, urlOf, indexOf);
        const stored = wiki.sanitizeContent(r.html);
        const storedImgs = countMatches(stored, /<img\b/g);
        const storedFigs = countMatches(stored, /<figure\b/g);
        const storedPending = countMatches(stored, /wiki-pending-image/g);
        if (storedImgs !== r.imgCount || storedFigs !== r.figureCount || storedPending !== r.pendingCount) {
            sanitizeWarnings.push(
                `${page.title}: 渲染 img/figure/pending=${r.imgCount}/${r.figureCount}/${r.pendingCount} ` +
                `消毒后=${storedImgs}/${storedFigs}/${storedPending}`
            );
        }
        const bodyText = r.text;
        // 摘要 = 正文前 100 字（默认跳过卷标和 h2 标题，免得摘要以标题开头）
        const summaryText = SUMMARY_INCLUDE_TITLE
            ? bodyText
            : (pageText(page, { skipTitleAndVolume: true }) || bodyText);
        rendered.push({
            page,
            html: r.html,
            stored,
            summary: summaryText.slice(0, 100),
            textLength: bodyText.length,
            imgCount: storedImgs,
            figureCount: storedFigs,
            pendingCount: storedPending,
            imageCount: r.imageCount,
            rawImgCount: r.imgCount,
            bytes: Buffer.byteLength(stored, 'utf8')
        });
    }

    /* 6) dryRun：打印清单 */
    log('');
    log('--- 页面清单 ---');
    log(padRight('#', 4) + padRight('标题', 40) + padRight('分类', 12) + padRight('正文字数', 10) + padRight('图片数', 8) + '说明');
    rendered.forEach((r, i) => {
        const note = [];
        if (r.pendingCount) note.push(`占位 ${r.pendingCount}`);
        log(padRight(i + 1, 4) + padRight(r.page.title, 40) + padRight(r.page.category, 12) +
            padRight(r.textLength, 10) + padRight(r.imageCount, 8) + note.join(' '));
    });

    /* 7) 写库 */
    const pageResults = [];
    let revBefore = 0;
    if (dryRun) {
        log('');
        log('dryRun：不写数据库、不上传图片。');
        rendered.forEach(r => pageResults.push({ title: r.page.title, action: 'dry-run' }));
    } else {
        const author = await resolveAuthor(log);
        revBefore = (await db.get('SELECT COUNT(*) AS c FROM wiki_revisions'))?.c || 0;
        log('');
        log('同步分类……');
        const root = await ensureCategory({ name: CATEGORY_ROOT, parentId: null, sortOrder: 1, description: '玄剑公会历史资料' }, author.id, log);
        const main = await ensureCategory({ name: CATEGORY_MAIN, parentId: root.id, sortOrder: 1, description: '《玄剑公会通史0517》正文各章' }, author.id, log);
        const preface = await ensureCategory({ name: CATEGORY_PREFACE, parentId: root.id, sortOrder: 2, description: '纪年表、序与史诗、人物档案' }, author.id, log);
        const catId = { [CATEGORY_MAIN]: main.id, [CATEGORY_PREFACE]: preface.id };

        log('同步页面……');
        for (const r of rendered) {
            const categoryId = catId[r.page.category];
            if (!categoryId) throw new Error(`页面「${r.page.title}」没有匹配到分类：${r.page.category}`);
            const res = await upsertPage({
                title: r.page.title, html: r.stored, summary: r.summary, categoryId
            }, author.id, log);
            pageResults.push({ title: r.page.title, action: res.action, id: res.id, category: r.page.category });
            log(`  ${({ created: '＋新建', updated: '↻更新', unchanged: '＝未变' })[res.action]} #${res.id} ${r.page.title}`);
        }
    }

    /* 8) 自检 */
    const checks = [];
    checks.push(['页数 == ' + EXPECTED_PAGES, pages.length === EXPECTED_PAGES, `实际 ${pages.length}`]);

    const perPageOk = rendered.every(r => r.figureCount === r.imageCount);
    checks.push(['每页 figure 数 == 解析到的图片数', perPageOk,
        rendered.filter(r => r.figureCount !== r.imageCount).map(r => r.page.title).join(',') || 'ok']);

    const sanitizeOk = sanitizeWarnings.length === 0;
    checks.push(['消毒后 img/figure/占位数量不变', sanitizeOk, sanitizeWarnings.slice(0, 3).join(' | ') || 'ok']);

    const sumPageImgs = rendered.reduce((a, r) => a + r.imageCount, 0);
    checks.push(['页内图片总数 == 解析到的页内引用数', sumPageImgs === inPageRefs.length,
        `${sumPageImgs} vs ${inPageRefs.length}`]);

    checks.push([`前置图引用数 == ${EXPECTED_FRONT_IMAGES}`, frontRefs.length === EXPECTED_FRONT_IMAGES,
        `实际 ${frontRefs.length}（去重 ${frontPlan.length} 张）`]);

    const frontRendered = rendered.find(r => r.page.title === FRONT_PAGE_TITLE);
    checks.push([`存在「${FRONT_PAGE_TITLE}」页且图片齐全`,
        !!frontRendered && frontRendered.imageCount === frontRefs.length && frontRendered.figureCount === frontRefs.length,
        frontRendered ? `figure ${frontRendered.figureCount}/${frontRefs.length}` : '未生成']);

    const infoRows = (pages[0] && pages[0].title === FRONT_PAGE_TITLE
        ? (pages[0].parts.find(p => p.type === 'kv') || { rows: [] }).rows : []);
    checks.push(['编写信息解析成表格（>= 5 行）', infoRows.length >= 5,
        `${infoRows.length} 行：` + infoRows.map(r => r.label).join('/')]);

    checks.push(['文档内图片引用全部落在页面里（不丢图）', excluded === 0, `未纳入 ${excluded} 处`]);

    if (!dryRun && uploadImages && !limit) {
        const bad = [];
        for (const r of rendered) {
            const srcs = [...r.stored.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
            if (srcs.length !== r.imageCount) bad.push(`${r.page.title}: ${srcs.length}/${r.imageCount}`);
            for (const s of srcs) if (!/^https:\/\//.test(s)) bad.push(`${r.page.title}: ${s}`);
        }
        checks.push(['所有 <img src> 均为 https:// 且数量齐备', bad.length === 0, bad.slice(0, 3).join(' | ') || 'ok']);
    }

    // 回读数据库：确认真正入库的内容与消毒预览一致、img 数量与 https 正确（不是只检查内存里的字符串）
    if (!dryRun) {
        const mismatch = [];
        const dbUrlBad = [];
        for (const r of rendered) {
            const row = await db.get('SELECT content FROM wiki_pages WHERE title = ?', [r.page.title]);
            if (!row) { mismatch.push(`${r.page.title}: 库里没有这一页`); continue; }
            if (row.content !== r.stored) mismatch.push(`${r.page.title}: 入库内容与消毒预览不一致`);
            const srcs = [...row.content.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(m => m[1]);
            if (!limit && uploadImages && srcs.length !== r.imageCount) {
                mismatch.push(`${r.page.title}: img ${srcs.length}/${r.imageCount}`);
            }
            for (const s of srcs) if (!/^https:\/\//.test(s)) dbUrlBad.push(`${r.page.title}: ${s}`);
        }
        checks.push(['回读数据库：入库内容 == 消毒预览', mismatch.length === 0, mismatch.slice(0, 3).join(' | ') || 'ok']);
        if (uploadImages && !limit) {
            checks.push(['回读数据库：img src 均为 https://', dbUrlBad.length === 0, dbUrlBad.slice(0, 3).join(' | ') || 'ok']);
        }
        const revAfter = (await db.get('SELECT COUNT(*) AS c FROM wiki_revisions'))?.c || 0;
        const changed = pageResults.filter(p => p.action === 'created' || p.action === 'updated').length;
        checks.push(['revision 增量 == 新建+更新页数（幂等、不灌版本）',
            revAfter - revBefore === changed, `${revAfter - revBefore} vs ${changed}`]);
    }

    log('');
    log('--- 自检 ---');
    let failed = 0;
    for (const [name, ok, extra] of checks) {
        if (!ok) failed += 1;
        log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`);
    }

    const report = {
        dryRun,
        uploadImages,
        imageLimit: limit,
        docxDir: dir,
        pages: pages.length,
        pageTitles: rendered.map(r => r.page.title),
        pageResults,
        documentImageRefs: allRefs.length,
        uniqueMediaInDocument: new Set(allRefs.filter(r => relMap[r]).map(r => path.basename(relMap[r]))).size,
        inPageImageRefs: inPageRefs.length,
        excludedImageRefs: excluded,
        uniqueImages: plan.length,
        frontPage: {
            title: FRONT_PAGE_TITLE,
            refs: frontRefs.length,
            uniqueImages: frontPlan.length,
            plannedUploads: uploadImages ? frontToUpload.length : 0,
            plannedUploadBytes: frontBytes,
            skippedCoverTextLines: (pages[0] && pages[0].skippedCoverLines) || 0,
            infoRows: infoRows.map(r => ({ label: r.label, value: r.value }))
        },
        uploaded,
        uploadedBytes: uploadBytes,
        cacheHits: cacheHits.length,
        pending: limit ? Math.max(0, plan.length - limit) : (uploadImages ? 0 : plan.length),
        plannedUploads: uploadImages ? toUpload.length : 0,
        plannedUploadBytes: plannedBytes,
        imageCacheFile: IMAGE_CACHE_FILE,
        perPage: rendered.map(r => ({
            title: r.page.title, category: r.page.category, textLength: r.textLength,
            images: r.imageCount, imgs: r.imgCount, pending: r.pendingCount, bytes: r.bytes
        })),
        checks: checks.map(([name, ok, extra]) => ({ name, ok, extra })),
        cacheWarnings: sanitizeWarnings,
        elapsedMs: Date.now() - t0
    };

    log('');
    log(`完成：${pages.length} 页（含前置页）/ 页内图片 ${inPageRefs.length} 处（唯一 ${plan.length} 张，前置图 ${frontRefs.length} 处）` +
        `${dryRun ? ' · dryRun 未落库' : ` · 新建 ${pageResults.filter(p => p.action === 'created').length} 更新 ${pageResults.filter(p => p.action === 'updated').length} 未变 ${pageResults.filter(p => p.action === 'unchanged').length}`}` +
        ` · 本次上传 ${uploaded} 张（${humanMB(uploadBytes)}）· 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    if (failed) {
        const err = new Error(`自检失败 ${failed} 项：` + checks.filter(c => !c[1]).map(c => c[0]).join('；'));
        err.report = report;
        throw err;
    }
    return report;
}

/* ==================== CLI ==================== */

if (require.main === module) {
    const argv = process.argv.slice(2);
    const getArg = (name) => {
        const hit = argv.find(a => a === name || a.startsWith(name + '='));
        if (!hit) return undefined;
        const eq = hit.indexOf('=');
        return eq >= 0 ? hit.slice(eq + 1) : true;
    };
    const opts = {
        dryRun: !!getArg('--dry-run'),
        uploadImages: getArg('--no-images') === undefined,
        imageLimit: Number(getArg('--limit') || 0) || 0
    };
    seedHistory(opts)
        .then(() => { db.close(); process.exit(0); })
        .catch(e => {
            console.error('\n导入失败：' + e.message);
            if (e.report) console.error(JSON.stringify(e.report.checks, null, 2));
            db.close();
            process.exit(1);
        });
}

module.exports = {
    seedHistory,
    _internal: {
        parseDocumentXml,
        parseTableRows,
        parseInfoSection,
        buildPageModels,
        renderPageModel,
        renderTable,
        renderInfoTable,
        linkify,
        compressImage,
        loadImageCache,
        saveImageCache,
        resolveDocxDir,
        sha1,
        stripTitlePrefix,
        humanMB,
        IMAGE_CACHE_FILE,
        FOOTER_HTML,
        EXPECTED_PAGES,
        EXPECTED_FRONT_IMAGES,
        FRONT_PAGE_TITLE,
        CATEGORY_ROOT, CATEGORY_MAIN, CATEGORY_PREFACE
    }
};
