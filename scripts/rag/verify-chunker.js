/**
 * 分块器自检：真实样例（标题/列表/表格/代码/短代码）走一遍，检查结构与边界
 * 用法：node scripts/rag/verify-chunker.js
 */
const { chunkPage, htmlToBlocks, CHUNKER_VERSION, buildEmbedText } = require('../../lib/rag/chunker');

const SAMPLE = `
<h2>入会流程</h2>
<p>申请加入玄剑公会需要满足以下条件：</p>
<ul>
  <li>年满 14 周岁，能遵守公会章程；</li>
  <li>拥有正版 Minecraft 账号；</li>
  <li>近 30 天内无严重违规记录。</li>
</ul>
<p>审核由 {{member:morzane}} 负责，通过后进入观察期。</p>
<h3>观察期规定</h3>
<p>观察期为 14 天，期间需完成至少 3 次公会活动参与记录，否则延期。</p>
<h3>费用表</h3>
<table>
  <caption>入会费用</caption>
  <tr><th>项目</th><th>金额</th><th>说明</th></tr>
  <tr><td>入会费</td><td>0 贡献点</td><td>免收</td></tr>
  <tr><td>保证金</td><td>50 贡献点</td><td>退出时退还</td></tr>
</table>
<h3>处罚示例配置</h3>
<pre>rules:
  warn: 1
  mute: 3
  ban: permanent</pre>
<p>以上配置仅作示例，具体以管理组公告为准。{{generation:第一代}}成员不适用保证金条款。</p>
`;

let pass = 0;
const fails = [];
const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  OK   ' + name); }
    else { fails.push(name); console.log('  FAIL ' + name + (extra ? ' | ' + extra : '')); }
};

console.log('=== 1. HTML → 结构块 ===');
const blocks = htmlToBlocks(SAMPLE);
console.log('  块类型: ' + blocks.map((b) => b.type + (b.level ? b.level : '')).join(', '));
check('有标题块', blocks.some((b) => b.type === 'heading'));
check('有列表块', blocks.some((b) => b.type === 'list'));
check('有表格块', blocks.some((b) => b.type === 'table'));
check('有代码块', blocks.some((b) => b.type === 'code'));
check('图片 URL 未进入正文', !blocks.some((b) => /http|\.png|\.jpg/.test(b.text)));

console.log('\n=== 2. 表格保留行列关系 ===');
const table = blocks.find((b) => b.type === 'table');
check('表格含表头与两行数据', table && table.rows && table.rows.length >= 3, table ? JSON.stringify(table.rows[0]) : '无表格');
check('表格用 | 分隔列', table && table.text.includes(' | '), table && table.text.split('\n')[0]);

console.log('\n=== 3. 短代码转稳定文本 ===');
const allText = blocks.map((b) => b.text).join('\n');
check('{{member:}} 转为（成员：）', /（成员：morzane）/.test(allText), allText.match(/（成员[^）]*）/)?.[0]);
check('{{generation:}} 转为（代系：）', /（代系：第一代）/.test(allText), allText.match(/（代系[^）]*）/)?.[0]);
check('短代码原文不残留', !/\{\{|\}\}/.test(allText));

console.log('\n=== 4. 分块 ===');
const chunks = chunkPage({ title: '入会制度', content: SAMPLE, categoryPath: '制度 / 入会' }, { chunkSize: 320, overlap: 60 });
console.log('  分块数: ' + chunks.length + '，版本 ' + CHUNKER_VERSION);
chunks.forEach((c, i) => console.log(`   #${i} [${c.headingPath || '(无章节)'}] ${c.charLen} 字: ${c.text.slice(0, 46).replace(/\n/g, ' ⏎ ')}`));

check('分块非空', chunks.length > 0);
check('序号连续', chunks.every((c, i) => c.ordinal === i));
check('每块有字符数', chunks.every((c) => c.charLen === c.text.length));
check('常规块不超长', chunks.filter((c) => !c.text.includes('\n')).every((c) => c.charLen <= 320 + 80));
check('表格块完整（未被拆散）', chunks.some((c) => c.text.includes('保证金') && c.text.includes('入会费')));
check('代码块完整', chunks.some((c) => c.text.includes('rules:') && c.text.includes('ban: permanent')));
check('章节路径保留', chunks.some((c) => c.headingPath.includes('观察期')));

console.log('\n=== 5. Embedding 文本组装 ===');
const embedText = buildEmbedText({ title: '入会制度', categoryPath: '制度 / 入会', headingPath: chunks[0].headingPath, text: chunks[0].text });
check('含标题/分类/章节前缀', embedText.includes('标题：入会制度') && embedText.includes('分类：制度 / 入会'));
check('标题只出现一次', (embedText.match(/入会制度/g) || []).length === 1, String((embedText.match(/入会制度/g) || []).length));

console.log(`\n=== 结果：通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) { console.log('失败项：' + fails.join('、')); process.exitCode = 1; }
