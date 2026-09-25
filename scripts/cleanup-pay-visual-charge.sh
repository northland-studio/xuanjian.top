#!/bin/bash
# 清理「官网开缴费单」可视化验收产生的数据（不动真实用户的正常记录）
set -e
cd /var/www/xuanjian-guild
node - <<'JS'
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('data/guild.db');
const run = (s, a = []) => new Promise((r, j) => db.run(s, a, function (e) { e ? j(e) : r(this); }));
const get = (s, a = []) => new Promise((r, j) => db.get(s, a, (e, x) => e ? j(e) : r(x)));
(async () => {
  const before = await get("SELECT id FROM pay_intents WHERE token = 'ciA_fG2FPl8tfjF3EJrqGg'");
  if (before) {
    await run("DELETE FROM pay_charges WHERE intent_id = ?", [before.id]);
    await run("DELETE FROM pay_intents WHERE id = ?", [before.id]);
    console.log('  已删除验收缴费单 intent=' + before.id);
  } else {
    console.log('  验收缴费单不存在（可能已清理）');
  }
  // 未被任何意图引用的活动摊位收款主体
  const orphan = await run("DELETE FROM pay_payees WHERE type='event' AND id NOT IN (SELECT DISTINCT payee_id FROM pay_intents)");
  console.log('  清理无主活动摊位主体: ' + (orphan.changes || 0));
  // 近 15 分钟的 pay 通知（验收时"被加入名单"的提醒）
  const notif = await run("DELETE FROM notifications WHERE type='pay' AND created_at >= datetime('now','localtime','-15 minutes')");
  console.log('  清理近 15 分钟 pay 通知: ' + (notif.changes || 0));

  const counts = await get(`SELECT (SELECT COUNT(*) FROM pay_intents) AS intents,
      (SELECT COUNT(*) FROM pay_transactions) AS txs,
      (SELECT COUNT(*) FROM pay_charges) AS charges,
      (SELECT COUNT(*) FROM pay_payees) AS payees`);
  console.log(`  现状：意图 ${counts.intents} / 流水 ${counts.txs} / 名单 ${counts.charges} / 主体 ${counts.payees}`);
  console.log('  金库：' + JSON.stringify(await get("SELECT nickname, contribution FROM users WHERE username='guild_treasury'")));
  db.close();
})().catch(e => { console.error(e); process.exit(1); });
JS
