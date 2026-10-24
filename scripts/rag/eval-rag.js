/**
 * 检索与回答评测集（24 例）
 *
 * 用法：RAG_EMBEDDING_KEY=... RAG_LLM_KEY=... node scripts/rag/eval-rag.js
 *
 * 在独立临时库中构造 8 篇已发布 Wiki（覆盖制度/入会/贡献/活动/处分/技术）
 * + 2 篇草稿/归档噪声，真实调用 Embedding 与 LLM，统计：
 *   - 检索命中率（Top-K 是否含期望页面）
 *   - 来源正确率（返回 sources 是否含期望页面）
 *   - 拒答正确率（无答案问题是否 abstained）
 *   - 引用合法率
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const TMP = path.join(os.tmpdir(), `rag-eval-${Date.now()}.db`);
process.env.DB_FILE = TMP;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'rag-eval-secret-0123456789abcdef';
process.env.RAG_SECRET_KEY = process.env.RAG_SECRET_KEY || 'rag-eval-master-key-0123456789abcdef';
process.env.RAG_DISABLE_WORKER = '1';

const ROOT = path.resolve(__dirname, '..', '..');
const run = (script) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', script)], { cwd: ROOT, env: { ...process.env }, stdio: 'pipe' });

const PAGES = [
    { title: '入会申请条件', cat: '入会', body: '<h2>基本条件</h2><p>申请加入玄剑公会需年满 14 周岁，拥有正版 Minecraft 账号，且近 30 天内无严重违规记录。</p><h2>审核流程</h2><p>提交申请后由管理组在 3 个工作日内审核，通过后进入 14 天观察期，期间需完成至少 3 次公会活动。</p>' },
    { title: '保证金与入会费用', cat: '入会', body: '<h2>费用</h2><p>入会费为 0 贡献点，免收。保证金为 50 贡献点，退出公会时全额退还。</p><table><tr><th>项目</th><th>金额</th></tr><tr><td>入会费</td><td>0</td></tr><tr><td>保证金</td><td>50</td></tr></table>' },
    { title: '贡献点获取规则', cat: '制度', body: '<h2>获取方式</h2><p>参与公会活动每次 5 贡献点；完成每周任务 10 贡献点；贡献建设材料按价值折算。每日签到固定 2 贡献点。</p><h2>上限</h2><p>每日通过签到与活动最多获取 30 贡献点。</p>' },
    { title: '贡献点使用与兑换', cat: '制度', body: '<h2>用途</h2><p>贡献点可用于兑换商城物品、报名付费活动、缴纳保证金。不可转让给其他成员。</p>' },
    { title: '处分等级与申诉', cat: '制度', body: '<h2>处分等级</h2><p>警告 1 次、禁言 3 天、严重者永久封禁。处分由管理组集体决定。</p><h2>申诉</h2><p>对处分有异议可在 7 天内向管理组提交申诉，管理组在 5 个工作日内答复。</p>' },
    { title: '活动安排与报名', cat: '活动', body: '<h2>常规活动</h2><p>每周六 20:00 举行公会活动，报名截止时间为活动当天 18:00。</p><h2>缺席</h2><p>报名后无故缺席 2 次将暂停报名资格一周。</p>' },
    { title: '服务器技术规范', cat: '技术', body: '<h2>红石限制</h2><p>单区块红石更新频率不得超过 20Hz，禁止使用高频时钟。刷怪塔需报备。</p>' },
    { title: '仓库与物资管理', cat: '制度', body: '<h2>公共仓库</h2><p>公共仓库物资按需取用，取用需在日志本登记。私自大量搬运视为违规。</p>' }
];

const DRAFTS = [
    { title: '未发布的收费新规', body: '<p>这条制度还在草稿，不应被检索到。</p>', status: 'draft' },
    { title: '已归档的旧入会标准', body: '<p>这是旧标准，已废弃，不应作为依据。</p>' }
];

const CASES = [
    { q: '加入公会需要满足什么条件', expect: ['入会申请条件'], type: 'answer' },
    { q: '入会要交多少钱', expect: ['保证金与入会费用'], type: 'answer' },
    { q: '保证金什么时候退', expect: ['保证金与入会费用'], type: 'answer' },
    { q: '观察期多久，要完成几次活动', expect: ['入会申请条件'], type: 'answer' },
    { q: '贡献点怎么获得', expect: ['贡献点获取规则'], type: 'answer' },
    { q: '每日最多能拿多少贡献点', expect: ['贡献点获取规则'], type: 'answer' },
    { q: '贡献点可以用来做什么', expect: ['贡献点使用与兑换'], type: 'answer' },
    { q: '贡献点能不能转给别人', expect: ['贡献点使用与兑换'], type: 'answer' },
    { q: '被禁言了怎么申诉', expect: ['处分等级与申诉'], type: 'answer' },
    { q: '处分有哪些等级', expect: ['处分等级与申诉'], type: 'answer' },
    { q: '活动一般什么时候举行', expect: ['活动安排与报名'], type: 'answer' },
    { q: '报名活动后不去会怎样', expect: ['活动安排与报名'], type: 'answer' },
    { q: '红石有什么限制', expect: ['服务器技术规范'], type: 'answer' },
    { q: '公共仓库的东西怎么取', expect: ['仓库与物资管理'], type: 'answer' },
    { q: '入会审核要几个工作日', expect: ['入会申请条件'], type: 'answer' },
    { q: '签到给多少贡献', expect: ['贡献点获取规则'], type: 'answer' },
    { q: '仓库条例允许随便拿吗', expect: ['仓库与物资管理'], type: 'answer' },
    { q: '活动报名截止时间', expect: ['活动安排与报名'], type: 'answer' },
    // 无答案 / 应拒答
    { q: '公会创始人的真实姓名和家庭住址', expect: [], type: 'abstain' },
    { q: '2024 年 3 月的财务报表数据', expect: [], type: 'abstain' },
    { q: '公会服务器管理员的手机号', expect: [], type: 'abstain' },
    // 草稿/归档不得作为依据
    { q: '收费新规具体金额是多少', expect: [], type: 'abstain', mustNot: ['未发布的收费新规'] },
    { q: '旧的入会标准是什么', expect: [], type: 'abstain', mustNot: ['已归档的旧入会标准'] },
    { q: '公会一共有多少名成员', expect: [], type: 'abstain' }
];

(async () => {
    console.log('=== 玄剑姬 评测集 ===');
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
    run('migrate-wiki.js');
    run('migrate-rag.js');

    const db = require(path.join(ROOT, 'database'));
    await db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, nickname TEXT, email TEXT, password TEXT, level INTEGER DEFAULT 0, contribution INTEGER DEFAULT 0, avatar TEXT, game_id TEXT, generation TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await db.run("INSERT OR IGNORE INTO users (id, username, nickname, level) VALUES (1,'tester','测试账号',2)");

    const wiki = require(path.join(ROOT, 'lib', 'wiki'));
    const indexer = require(path.join(ROOT, 'lib', 'rag', 'indexer'));
    const retriever = require(path.join(ROOT, 'lib', 'rag', 'retriever'));
    const ragAsk = require(path.join(ROOT, 'lib', 'rag', 'ask'));
    const vec = require(path.join(ROOT, 'lib', 'rag', 'vec'));
    await vec.load();

    // 评测批跑 24 个问题，必须放宽限流，否则第 4 个问题起会被每分钟限制挡住
    await require(path.join(ROOT, 'lib', 'rag', 'config')).setMany({
        'rag.guestPerMinute': 999,
        'rag.guestPerDay': 9999
    });

    const catIds = {};
    for (const name of ['制度', '入会', '活动', '技术']) {
        const r = await db.run("INSERT INTO wiki_categories (name, slug) VALUES (?, ?)", [name, 'cat-' + name]);
        catIds[name] = r.id;
    }
    for (const p of PAGES) {
        await wiki.createPage({ category_id: catIds[p.cat], title: p.title, content: p.body, status: 'published' }, 1);
    }
    for (const d of DRAFTS) {
        const r = await wiki.createPage({ category_id: catIds['制度'], title: d.title, content: d.body, status: d.status || 'published' }, 1);
        if (!d.status) await wiki.setPageStatus(r.id, 'archived', 1);
    }

    console.log('索引中…');
    await indexer.processTasks(40);
    const st = await indexer.stats();
    console.log(`已索引 ${st.indexedPages} 篇 / ${st.chunks} 块 / ${st.vectors} 向量`);

    let hit = 0, srcOk = 0, abstainOk = 0, citeOk = 0, answerTotal = 0, abstainTotal = 0, leak = 0;
    const rows = [];
    for (const c of CASES) {
        const r = await ragAsk.ask({ question: c.q, sourceType: 'web_guest', subjectId: 'ip:eval' });
        const titles = (r.sources || []).map((s) => s.title);
        const isAbstain = !!r.abstained;
        const citeValid = ragAsk.validateCitations(r.answer || '', 10).ok;
        if (c.type === 'answer') {
            answerTotal++;
            if (c.expect.some((t) => titles.includes(t))) { hit++; srcOk++; }
            if (citeValid) citeOk++;
        } else {
            abstainTotal++;
            if (isAbstain) abstainOk++;
        }
        if (c.mustNot && titles.some((t) => c.mustNot.includes(t))) leak++;
        rows.push({
            q: c.q,
            type: c.type,
            abstained: isAbstain,
            sources: titles,
            citeValid,
            ok: c.type === 'answer' ? c.expect.some((t) => titles.includes(t)) : isAbstain
        });
    }

    console.log('\n问题 | 类型 | 拒答 | 来源 | 引用合法 | 判定');
    for (const r of rows) {
        console.log(`${r.q} | ${r.type} | ${r.abstained ? '是' : '否'} | ${r.sources.join('/') || '-'} | ${r.citeValid ? '是' : '否'} | ${r.ok ? 'PASS' : 'FAIL'}`);
    }

    const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '0.0') + '%';
    console.log('\n=== 指标 ===');
    console.log(`检索/来源命中率：${hit}/${answerTotal} (${pct(hit, answerTotal)})`);
    console.log(`拒答正确率：${abstainOk}/${abstainTotal} (${pct(abstainOk, abstainTotal)})`);
    console.log(`引用合法率：${citeOk}/${answerTotal} (${pct(citeOk, answerTotal)})`);
    console.log(`草稿/归档泄露：${leak} 次`);

    try { db.close(); } catch {}
    fs.rmSync(TMP, { force: true });
    const pass = hit === answerTotal && abstainOk === abstainTotal && leak === 0;
    console.log(pass ? '\n结论：达到验收线' : '\n结论：未达验收线，需要调参');
    process.exit(pass ? 0 : 1);
})().catch((e) => {
    console.error('评测异常：' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
