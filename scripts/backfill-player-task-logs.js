// 补录：为缺失的历史玩家任务补记发布扣款流水（player_task 类型）
// 背景：contribution_logs 表 CHECK 约束曾缺 player_task 类型，导致 8 条任务发布时扣款已生效但流水缺失。
// 用法：node scripts/backfill-player-task-logs.js          （dry-run 预览）
//       node scripts/backfill-player-task-logs.js --apply  （实际写入）
const db = require('../database');

const APPLY = process.argv.includes('--apply');

(async () => {
    try {
        // 1. 找出所有缺少「发布扣款流水」的玩家任务（amount < 0 的 player_task 记录）
        const tasks = await db.all(
            `SELECT pt.id, pt.author_id, pt.title, pt.reward, pt.created_at
             FROM player_tasks pt
             WHERE NOT EXISTS (
                 SELECT 1 FROM contribution_logs cl
                 WHERE cl.type = 'player_task' AND cl.amount < 0 AND cl.ref_id = pt.id
             )
             ORDER BY pt.author_id ASC, pt.created_at ASC, pt.id ASC`
        );

        console.log(`[${APPLY ? 'APPLY' : 'DRY-RUN'}] 找到 ${tasks.length} 条缺扣款流水的玩家任务`);

        if (tasks.length === 0) {
            process.exit(0);
        }

        // 2. 按作者分组，逐作者从「最早任务前」的余额开始，按时间顺序扣减，得到每个任务的 balance_after
        const byAuthor = {};
        for (const t of tasks) {
            (byAuthor[t.author_id] = byAuthor[t.author_id] || []).push(t);
        }

        const plan = [];
        for (const authorId of Object.keys(byAuthor)) {
            const authorTasks = byAuthor[authorId];
            const earliest = authorTasks[0];

            // 该作者最早任务之前最后一条流水的 balance_after，作为扣款前余额（无则视为 0）
            const prev = await db.get(
                `SELECT balance_after FROM contribution_logs
                 WHERE user_id = ? AND created_at < ?
                 ORDER BY created_at DESC, id DESC LIMIT 1`,
                [authorId, earliest.created_at]
            );
            let running = prev ? (prev.balance_after ?? 0) : 0;

            for (const t of authorTasks) {
                running -= t.reward;
                plan.push({
                    author_id: t.author_id,
                    task_id: t.id,
                    title: t.title,
                    reward: t.reward,
                    amount: -t.reward,
                    balance_after: running,
                    created_at: t.created_at
                });
            }
        }

        // 3. 输出计划
        console.log('\n补录计划：');
        for (const p of plan) {
            console.log(`  任务#${p.task_id} [作者 ${p.author_id}] 「${p.title}」 扣 ${p.reward} → balance_after=${p.balance_after} @ ${p.created_at}`);
        }

        if (!APPLY) {
            console.log('\n（DRY-RUN 模式，未写入。确认无误后加 --apply 实际执行）');
            process.exit(0);
        }

        // 4. 实际写入
        for (const p of plan) {
            await db.run(
                `INSERT INTO contribution_logs (user_id, amount, type, ref_id, note, balance_after, created_at)
                 VALUES (?, ?, 'player_task', ?, ?, ?, ?)`,
                [p.author_id, p.amount, p.task_id, `发布任务：${p.title}`, p.balance_after, p.created_at]
            );
        }
        console.log(`\n已补录 ${plan.length} 条流水`);

        process.exit(0);
    } catch (e) {
        console.error('补录失败:', e.message, e.stack);
        process.exit(1);
    }
})();
