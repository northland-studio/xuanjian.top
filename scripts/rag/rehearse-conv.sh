#!/bin/bash
# 生产环境折算演练：生成预览 → 校验明细 → 删除预览（不应用，零风险）
set -u
APP=/var/www/xuanjian-guild
cd "$APP"

node -e "
require('dotenv').config();
const db=require('./database');
const conv=require('./lib/contribution-conversion');
(async()=>{
  console.log('=== 1. 统一比例 ×0.5 预览 ===');
  const p1=await conv.buildPlan({mode:'uniform', uniformRatio:0.5, scope:'positive'});
  const id1=await conv.createPreview(p1, {operatorId:2, note:'演练-统一比例'});
  console.log('  批次 #'+id1+' 参与 '+p1.affected+' 人, 总额 '+p1.totalBefore+' → '+p1.totalAfter+'（净变化 '+p1.totalDelta+'）');
  p1.items.slice(0,5).forEach(i=>console.log('    #'+i.rank+' '+i.nickname+' '+i.beforeValue+' ×'+i.ratio+' = '+i.afterValue+' ('+(i.delta>0?'+':'')+i.delta+')'));

  console.log('');
  console.log('=== 2. 区间折算预览（前10×1.2, 11-30×1.0, 其余×0.8）===');
  const p2=await conv.buildPlan({mode:'tiers', tiers:[{from:1,to:10,ratio:1.2},{from:11,to:30,ratio:1.0},{from:31,to:null,ratio:0.8}], scope:'positive'});
  const id2=await conv.createPreview(p2, {operatorId:2, note:'演练-区间'});
  console.log('  批次 #'+id2+' 参与 '+p2.affected+' 人, 总额 '+p2.totalBefore+' → '+p2.totalAfter);
  console.log('  前 3 名（应 ×1.2）: '+p2.items.slice(0,3).map(i=>i.nickname+' '+i.beforeValue+'→'+i.afterValue).join(' | '));
  const mid=p2.items.filter(i=>i.rank>=11&&i.rank<=30).slice(0,3);
  console.log('  11-30 名（应 ×1.0）: '+mid.map(i=>i.nickname+' '+i.beforeValue+'→'+i.afterValue).join(' | '));
  const tail=p2.items.filter(i=>i.rank>30).slice(0,3);
  console.log('  31 名后（应 ×0.8）: '+tail.map(i=>i.nickname+' '+i.beforeValue+'→'+i.afterValue).join(' | '));

  console.log('');
  console.log('=== 3. 校验：明细与主表数据一致 ===');
  const d1=await conv.getConversion(id1);
  const sum1=d1.items.reduce((s,i)=>s+Number(i.after_value),0);
  console.log('  批次 #'+id1+' 明细 '+d1.items.length+' 行, 明细合计='+sum1.toFixed(2)+' 主表 total_after='+d1.total_after+' → '+(Math.abs(sum1-d1.total_after)<0.05?'一致':'不一致'));

  console.log('');
  console.log('=== 4. 清理演练批次 ===');
  await conv.deletePreview(id1);
  await conv.deletePreview(id2);
  const left=await db.get('SELECT COUNT(*) AS c FROM contribution_conversions');
  const items=await db.get('SELECT COUNT(*) AS c FROM contribution_conversion_items');
  console.log('  剩余批次: '+left.c+'，剩余明细: '+items.c+'（应为 0/0）');

  console.log('');
  console.log('=== 5. 用户贡献点未被改动（抽样）===');
  const top=await db.all('SELECT nickname, contribution FROM users ORDER BY contribution DESC LIMIT 3');
  top.forEach(t=>console.log('    '+t.nickname+': '+t.contribution));
  const sum=await db.get('SELECT SUM(contribution) AS s FROM users');
  console.log('  全站贡献点总额: '+Number(sum.s).toFixed(2)+'（演练前为 2153.44）');
  process.exit(0);
})();" 2>&1 | grep -v dotenv
