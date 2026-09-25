#!/bin/bash
# 生产环境扫码支付 阶段 3-5 联调（付款码反扫 / 缴费单 / 审批 / 对账）
# 用两个临时账号跑通后彻底清理，不动真实用户余额
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-pay-20260925
cd "$APP"

cp "$STAGE/test-pay-e2e2.js" scripts/test-pay-e2e2.js

echo "[1/3] 创建临时测试账号（含 1 个临时管理员，用于开单与审批）..."
node -e "
const sqlite3=require('sqlite3');const db=new sqlite3.Database('data/guild.db');
db.serialize(()=>{
  db.run(\"INSERT INTO users (username,nickname,password,level,contribution,created_at) VALUES ('paytest_a','联调测试A','!paytest!',0,600,datetime('now','localtime'))\",function(){console.log('  A(付款人) id='+this.lastID);});
  db.run(\"INSERT INTO users (username,nickname,password,level,contribution,created_at) VALUES ('paytest_b','联调测试B','!paytest!',0,100,datetime('now','localtime'))\",function(){console.log('  B(收款人) id='+this.lastID);});
  db.run(\"INSERT INTO users (username,nickname,password,level,contribution,created_at) VALUES ('paytest_admin','联调管理员','!paytest!',5,0,datetime('now','localtime'))\",function(){console.log('  管理员 id='+this.lastID);});
  db.run(\"INSERT INTO users (username,nickname,password,level,contribution,created_at) VALUES ('paytest_out','联调名单外','!paytest!',0,10,datetime('now','localtime'))\",function(){console.log('  名单外 id='+this.lastID);db.close();});
});
"
IDS=$(node -e "const s=require('sqlite3');const d=new s.Database('data/guild.db');d.all(\"SELECT id FROM users WHERE username IN ('paytest_a','paytest_b') ORDER BY id\",(e,r)=>{console.log(r.map(x=>x.id).join(','));d.close();});")
echo "  用例账号: $IDS"

echo "[2/3] 运行阶段 3-5 联调（HTTP → 本机 3000）..."
set +e
PAY_TEST_USERS="$IDS" node scripts/test-pay-e2e2.js 3000
RC=$?
set -e

echo "[3/3] 清理测试账号与数据..."
node -e "
const sqlite3=require('sqlite3');const db=new sqlite3.Database('data/guild.db');
db.all(\"SELECT id FROM users WHERE username LIKE 'paytest%'\",(e,rows)=>{
  const ids=rows.map(r=>r.id); const ph=ids.map(()=>'?').join(',');
  db.serialize(()=>{
    db.run('DELETE FROM pay_transactions WHERE from_user_id IN ('+ph+')',ids);
    db.run('DELETE FROM pay_intents WHERE created_by IN ('+ph+') OR payer_user_id IN ('+ph+')',[...ids,...ids]);
    db.run('DELETE FROM pay_charges WHERE user_id IN ('+ph+')',ids);
    db.run('DELETE FROM pay_payees WHERE owner_user_id IN ('+ph+') OR user_id IN ('+ph+')',[...ids,...ids]);
    db.run('DELETE FROM contribution_logs WHERE user_id IN ('+ph+')',ids);
    db.run('DELETE FROM notifications WHERE user_id IN ('+ph+') OR actor_id IN ('+ph+')',[...ids,...ids]);
    db.run('DELETE FROM users WHERE id IN ('+ph+')',ids,function(){
      console.log('  已删除测试账号 '+this.changes+' 个');
      db.all(\"SELECT COUNT(*) c FROM users WHERE username LIKE 'paytest%'\",(e2,r2)=>{
        console.log('  残留测试账号: '+r2[0].c);
        db.get('SELECT COUNT(*) c FROM pay_charges',(e3,r3)=>{
          console.log('  当前缴费单名单总数: '+r3.c);
          db.close();
        });
      });
    });
  });
});
"
rm -f scripts/test-pay-e2e2.js
echo "联调退出码: $RC（0 = 全部通过）"
