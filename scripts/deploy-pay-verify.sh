#!/bin/bash
# 生产环境扫码支付闭环联调（使用临时测试账号，结束后彻底清理）
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-pay-20260925
cd "$APP"

cp "$STAGE/test-pay-e2e.js" scripts/test-pay-e2e.js

echo "[1/3] 创建临时测试账号..."
node -e "
const sqlite3=require('sqlite3');const db=new sqlite3.Database('data/guild.db');
const sql=\"INSERT INTO users (username,nickname,password,level,contribution,created_at) VALUES (?,?,'!paytest!',0,100,datetime('now','localtime'))\";
db.serialize(()=>{
  db.run(sql,['paytest_a','联调测试A'],function(){console.log('  A id='+this.lastID);
    db.run(sql,['paytest_b','联调测试B'],function(){console.log('  B id='+this.lastID);db.close();});});
});
" > /tmp/paytest-ids.txt 2>&1 || true
cat /tmp/paytest-ids.txt
IDS=$(node -e "const s=require('sqlite3');const d=new s.Database('data/guild.db');d.all(\"SELECT id FROM users WHERE username IN ('paytest_a','paytest_b') ORDER BY id\",(e,r)=>{console.log(r.map(x=>x.id).join(','));d.close();});")
echo "  测试账号: $IDS"

echo "[2/3] 运行闭环联调（HTTP → 本机 3000）..."
set +e
PAY_TEST_USERS="$IDS" node scripts/test-pay-e2e.js 3000
RC=$?
set -e

echo "[3/3] 清理测试账号与数据..."
node -e "
const sqlite3=require('sqlite3');const db=new sqlite3.Database('data/guild.db');
const ids=[${IDS}];
const ph=ids.map(()=>'?').join(',');
db.serialize(()=>{
  db.run('DELETE FROM pay_transactions WHERE from_user_id IN ('+ph+')',ids);
  db.run('DELETE FROM pay_intents WHERE created_by IN ('+ph+') OR payer_user_id IN ('+ph+')',[...ids,...ids]);
  db.run('DELETE FROM pay_payees WHERE user_id IN ('+ph+')',ids);
  db.run('DELETE FROM contribution_logs WHERE user_id IN ('+ph+')',ids);
  db.run('DELETE FROM notifications WHERE user_id IN ('+ph+')',ids);
  db.run('DELETE FROM users WHERE id IN ('+ph+')',ids,function(){
    console.log('  已删除测试账号，影响行数 '+this.changes);
    db.all(\"SELECT COUNT(*) c FROM users WHERE username LIKE 'paytest%'\",(e,r)=>{console.log('  残留测试账号: '+r[0].c);
      db.all(\"SELECT COUNT(*) c FROM pay_transactions\",(e2,r2)=>{console.log('  当前流水总数: '+r2[0].c);db.close();});});
  });
});
"
rm -f scripts/test-pay-e2e.js
echo "联调退出码: $RC（0 = 全部通过）"
