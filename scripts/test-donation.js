/**
 * 捐赠墙核心逻辑测试（在导出库副本上跑，验证真实 schema）
 * 前置：先对副本执行迁移
 *   $env:DB_FILE="reports/_donation-test.db"; node scripts/migrate-20260918-donation.js
 *   $env:DB_FILE="reports/_donation-test.db"; node scripts/test-donation.js
 */
const path = require('path');

// 先加载 .env：lib/donation-upload.js 在模块加载时读取七牛凭证，
// 不加载的话 ready() 恒为 false，就无法验证「真实上传」路径。
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const db = require(path.join(__dirname, '..', 'database'));
const donation = require(path.join(__dirname, '..', 'lib', 'donation'));

let failed = 0;
const assert = (cond, msg) => {
    if (cond) console.log('  [ok] ' + msg);
    else { console.error('  [FAIL] ' + msg); failed++; }
};
const approx = (a, b, eps = 0.001) => Math.abs(Number(a) - Number(b)) < eps;

const balOf = async (uid) => (await db.get('SELECT COALESCE(contribution,0) AS c FROM users WHERE id=?', [uid])).c;

(async () => {
    // 选两个真实用户
    const u1 = await db.get('SELECT id, nickname, contribution FROM users ORDER BY id LIMIT 1');
    const u2 = await db.get('SELECT id, nickname, contribution FROM users WHERE id != ? ORDER BY id LIMIT 1', [u1.id]);
    console.log(`测试用户: u1=${u1.id}(${u1.nickname}) u2=${u2.id}(${u2.nickname})`);

    const b1 = await balOf(u1.id);
    const b2 = await balOf(u2.id);
    const before = await donation.summary();
    console.log('初始公账:', JSON.stringify(before));

    console.log('\n=== 1) 入账：100 元 × 比例 2 → 200 贡献点 ===');
    const r1 = await donation.createEntry({
        direction: 'in', userId: u1.id, amount: 100, ratio: 2,
        note: '测试捐赠', occurredOn: '2026-09-10', isPublic: true,
    }, 1);
    assert(!r1.error, '创建成功' + (r1.error ? `：${r1.error}` : ''));
    assert(approx(r1.points, 200), `points = 200（实际 ${r1.points}）`);
    assert(approx(await balOf(u1.id), b1 + 200), '用户贡献点 +200');

    const log1 = await db.get(`SELECT * FROM contribution_logs WHERE type='donation' AND ref_id=? ORDER BY id DESC LIMIT 1`, [r1.id]);
    assert(!!log1, "写入 contribution_logs(type='donation')");
    assert(log1 && approx(log1.amount, 200), '流水金额 = 200');

    console.log('\n=== 2) 支出：30 元 ===');
    const r2 = await donation.createEntry({
        direction: 'out', amount: 30, purpose: '服务器续费',
        note: '9月续费', occurredOn: '2026-09-11',
    }, 1);
    assert(!r2.error, '创建成功' + (r2.error ? `：${r2.error}` : ''));
    assert(approx(await balOf(u1.id), b1 + 200), '支出不影响贡献点');

    console.log('\n=== 3) 公账汇总 ===');
    const s1 = await donation.summary();
    console.log('  ', JSON.stringify(s1));
    const dB = { income: s1.income - before.income, expense: s1.expense - before.expense, balance: s1.balance - before.balance };
    assert(approx(dB.income, 100), `收入增量 100（实际 ${dB.income}）`);
    assert(approx(dB.expense, 30), `支出增量 30（实际 ${dB.expense}）`);
    assert(approx(dB.balance, 70), `余额增量 70（实际 ${dB.balance}）`);

    console.log('\n=== 4) 编辑：比例 2 → 3（差额 +100 贡献点）===');
    const r3 = await donation.updateEntry(r1.id, { amount: 100, ratio: 3, occurredOn: '2026-09-10' }, 1);
    assert(!r3.error, '编辑成功' + (r3.error ? `：${r3.error}` : ''));
    assert(approx(r3.points, 300), `points = 300（实际 ${r3.points}）`);
    assert(approx(await balOf(u1.id), b1 + 300), '用户贡献点 +300（差额已补）');

    console.log('\n=== 5) 编辑：改绑到另一个成员 ===');
    const r4 = await donation.updateEntry(r1.id, { amount: 100, ratio: 3, userId: u2.id, occurredOn: '2026-09-10' }, 1);
    assert(!r4.error, '改绑成功' + (r4.error ? `：${r4.error}` : ''));
    assert(approx(await balOf(u1.id), b1), '原成员贡献点已全额扣回');
    assert(approx(await balOf(u2.id), b2 + 300), '新成员贡献点 +300');

    console.log('\n=== 6) 小数金额与比例 ===');
    assert(approx(donation.calcPoints(0.08, 2.5), 0.2), '0.08 元 × 2.5 = 0.2 点（保留小数）');
    assert(approx(donation.calcPoints(33.33, 1.5), 49.995, 0.01), '33.33 × 1.5 ≈ 49.995');
    const r5 = await donation.createEntry({
        direction: 'in', userId: u2.id, amount: 0.08, ratio: 2.5, occurredOn: '2026-09-12',
    }, 1);
    assert(!r5.error, '小数入账创建成功');
    assert(approx(r5.points, 0.2), `points = 0.2（实际 ${r5.points}）`);

    console.log('\n=== 7) 捐赠者列表 ===');
    const donors = await donation.listDonors({ page: 1, limit: 50 });
    const d2 = donors.list.find(d => d.userId === u2.id);
    assert(!!d2, '捐赠者列表含 u2');
    assert(d2 && approx(d2.totalAmount, 100.08, 0.01), `u2 累计捐赠 100.08（实际 ${d2 && d2.totalAmount}）`);
    assert(d2 && approx(d2.totalPoints, 300.2, 0.01), `u2 累计获得 300.2 点（实际 ${d2 && d2.totalPoints}）`);
    assert(donors.list.every((d, i, a) => i === 0 || a[i - 1].totalAmount >= d.totalAmount), '按累计金额倒序');

    console.log('\n=== 8) 匿名捐赠 ===');
    const r6 = await donation.createEntry({
        direction: 'in', userId: u1.id, amount: 5, ratio: 1, occurredOn: '2026-09-12', isPublic: false,
    }, 1);
    assert(!r6.error, '匿名入账创建成功');
    const led = await donation.listLedger({ page: 1, limit: 50 });
    const anonRow = led.list.find(x => x.id === r6.id);
    assert(anonRow && anonRow.anonymous === true, '明细中标记为匿名');
    assert(anonRow && anonRow.donor && anonRow.donor.nickname === '匿名捐赠者', '匿名者昵称已脱敏');

    console.log('\n=== 9) 删除账目 → 贡献点回滚 ===');
    const b2b = await balOf(u2.id);
    const r7 = await donation.deleteEntry(r1.id, 1);
    assert(!r7.error, '删除成功' + (r7.error ? `：${r7.error}` : ''));
    assert(approx(await balOf(u2.id), b2b - 300), '已发放的 300 点已扣回');

    console.log('\n=== 10) 气泡购买（CHECK 白名单修复验证）===');
    const ub = await db.get('SELECT id FROM users ORDER BY id LIMIT 1');
    try {
        await db.run('BEGIN');
        await db.run(
            'INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after) VALUES (?,?,?,?,?,?)',
            [ub.id, -50, 'bubble', 2, '测试购买气泡', 0]
        );
        await db.run('ROLLBACK');
        assert(true, "type='bubble' 写入成功（气泡购买已修复）");
    } catch (e) {
        await db.run('ROLLBACK');
        assert(false, 'bubble 写入失败：' + e.message);
    }

    console.log('\n=== 11) 参数校验 ===');
    assert((await donation.createEntry({ direction: 'in', userId: u1.id, amount: 0, ratio: 1 }, 1)).error, '金额为 0 被拒绝');
    assert((await donation.createEntry({ direction: 'in', amount: 10, ratio: 1 }, 1)).error, '入账未选成员被拒绝');
    assert((await donation.createEntry({ direction: 'in', userId: 999999, amount: 10, ratio: 1 }, 1)).error, '不存在的成员被拒绝');
    assert((await donation.updateEntry(999999, { amount: 1 }, 1)).error, '编辑不存在的账目被拒绝');

    console.log('\n=== 12) 材料/收款码上传代码路径（回归：formUploader TDZ）===');
    const dUpload = require(path.join(__dirname, '..', 'lib', 'donation-upload'));
    // 1x1 PNG
    const PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
    );
    assert(dUpload.classify('image/png', 'a.png') === 'image', 'classify: PNG → image');
    assert(dUpload.classify('application/pdf', 'a.pdf') === 'pdf', 'classify: PDF → pdf');
    assert(dUpload.classify('text/plain', 'a.txt') === null, 'classify: 不支持的 txt → null');

    // 关键：调上传必须走到「配置缺失」或「真的上传成功」，绝不能是 ReferenceError（变量遮蔽/TDZ）
    const callUpload = async (fn, label) => {
        try {
            const r = await fn();
            console.log(`    ${label} 实际上传成功: ${r && (r.url || r)}`);
            assert(!!(r && (r.url || r)), `${label}: 返回了 URL`);
        } catch (e) {
            assert(!(e instanceof ReferenceError), `${label}: 不抛 ReferenceError（实际: ${e.message}）`);
            assert(/对象存储未配置|七牛/.test(e.message), `${label}: 失败属预期（配置/网络），实际: ${e.message}`);
        }
    };
    await callUpload(
        () => dUpload.uploadMaterial({ buffer: PNG, mimetype: 'image/png', originalname: 't.png', size: PNG.length }),
        'uploadMaterial'
    );
    await callUpload(
        () => dUpload.uploadQr({ buffer: PNG, mimetype: 'image/png', originalname: 'qr.png', size: PNG.length }),
        'uploadQr'
    );

    console.log(failed ? `\n=== 存在 ${failed} 个失败用例 ===` : '\n=== 全部通过 ===');
    db.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('测试异常:', e.stack || e.message); process.exit(1); });
