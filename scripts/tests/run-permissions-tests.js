/**
 * 权限体系测试统一入口
 *
 * 用法：node scripts/tests/run-permissions-tests.js
 * 依次执行三组测试（每组独立临时库、独立进程）：
 *   permissions-core.js     规范 1-11（Level/角色/失效/封禁/超管保护/无单用户授权）
 *   permissions-economy.js  规范 12-17（经济资格迁移/冻结恢复/转账获取消费/集市下单闸门）
 *   permissions-wiki.js     规范 18-19（Wiki 权限回归/前端权限刷新）
 *
 * 安全：全部使用临时数据库（复制 data/guild.db），不会连接生产库。
 */
const path = require('path');
const { spawnSync } = require('child_process');

const files = [
    ['permissions-core.js', '权限核心（1-11）'],
    ['permissions-economy.js', '经济资格（12-17）'],
    ['permissions-wiki.js', 'Wiki 回归 + 前端刷新（18-19）']
];

let failed = 0;
for (const [file, label] of files) {
    console.log(`\n========== ${label} :: ${file} ==========`);
    const r = spawnSync(process.execPath, [path.join(__dirname, file)], {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..', '..')
    });
    if (r.status !== 0) {
        failed++;
        console.error(`✘ ${label} 未通过（exit ${r.status}）`);
    } else {
        console.log(`✔ ${label} 通过`);
    }
}

if (failed) {
    console.error(`\n共 ${failed}/${files.length} 组测试失败`);
    process.exit(1);
}
console.log('\n全部权限测试通过 ✔');
