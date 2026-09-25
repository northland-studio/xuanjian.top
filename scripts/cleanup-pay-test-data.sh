#!/bin/bash
# 清理可视化验收产生的生产数据，恢复用户余额
set -e
cd /var/www/xuanjian-guild
node - <<'JS'
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('data/guild.db');
const run = (s, a = []) => new Promise((r, j) => db.run(s, a, function (e) { e ? j(e) : r(this); }));
const get = (s, a = []) => new Promise((r, j) => db.get(s, a, (e, x) => e ? j(e) : r(x)));
(async () => {
  const before = await get("SELECT id, nickname, contribution FROM users WHERE id = 2");
  console.log(`  清理前：user2=${before.contribution} 流水=${(await get('SELECT COUNT(*) c FROM pay_transactions')).c} 名单=${(await get('SELECT COUNT(*) c FROM pay_charges')).c} 意图=${(await get('SELECT COUNT(*) c FROM pay_intents')).c}`);

  await run("DELETE FROM pay_transactions WHERE from_user_id IN (SELECT id FROM users WHERE username='paytest_view')");
  await run("DELETE FROM contribution_logs WHERE type IN ('pay_out','pay_in')");
  await run("DELETE FROM notifications WHERE type = 'pay'");
  await run("DELETE FROM pay_charges WHERE intent_id IN (SELECT id FROM pay_intents WHERE created_at >= datetime('now','localtime','-3 hours')) OR user_id IN (SELECT id FROM users WHERE username='paytest_view')");
  await run("DELETE FROM pay_intents WHERE status IN ('created','scanned','expired','rejected','closed') AND created_at >= datetime('now','localtime','-3 hours')");
  await run("DELETE FROM pay_charges");
  await run("DELETE FROM pay_payees WHERE user_id IN (SELECT id FROM users WHERE username='paytest_view') OR owner_user_id IN (SELECT id FROM users WHERE username='paytest_view') OR display_name='验收演示缴费单'");
  await run("DELETE FROM users WHERE username='paytest_view'");
  await run("UPDATE users SET contribution = ? WHERE id = 2", [133.24]);

  const after = await get("SELECT contribution FROM users WHERE id = 2");
  console.log(`  清理后：user2=${after.contribution}（恢复为 133.24）`);
  console.log(`  剩余：流水=${(await get('SELECT COUNT(*) c FROM pay_transactions')).c} 名单=${(await get('SELECT COUNT(*) c FROM pay_charges')).c} 意图=${(await get('SELECT COUNT(*) c FROM pay_intents')).c} 主体=${(await get('SELECT COUNT(*) c FROM pay_payees')).c} 测试账号=${(await get("SELECT COUNT(*) c FROM users WHERE username LIKE 'paytest%'")).c}`);
  console.log(`  金库：${JSON.stringify(await get("SELECT id, nickname, contribution FROM users WHERE username='guild_treasury'"))}`);
  db.close();
})().catch(e => { console.error(e); process.exit(1); });
JS
