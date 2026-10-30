#!/bin/bash
# 部署 GLM 审核分类上下文（v2）并验证
set -u
APP=/var/www/xuanjian-guild
cd "$APP"

echo "=== 1. 备份并应用 ==="
cp lib/glm.js "lib/glm.js.bak-v1" 2>/dev/null || true
cp routes/wiki.js "routes/wiki.js.bak-v2" 2>/dev/null || true
cp /root/glm.js lib/glm.js
cp /root/wiki-routes.js routes/wiki.js
node --check lib/glm.js && node --check routes/wiki.js && echo "  语法 OK"
echo "  版本: $(grep -o 'wiki-review-v[0-9]' lib/glm.js | head -1)"
echo -n "  功能点: loadWikiContext=$(grep -c 'async function loadWikiContext' lib/glm.js) 分类判定=$(grep -c '【分类判定】' lib/glm.js) 分类树=$(grep -c '【Wiki 分类树】' lib/glm.js)"

echo
echo "=== 2. 真实分类树（将被注入提示词）==="
node -e "
require('dotenv').config();
const db=require('./database');
const glm=require('./lib/glm');
(async()=>{
  const cats=await db.all('SELECT id,name,parent_id,is_active FROM wiki_categories ORDER BY sort_order,id');
  const byId=new Map(cats.map(c=>[c.id,c]));
  const pathOf=(id)=>{const n=[];let cur=id,g=0;while(cur&&g++<10){const c=byId.get(cur);if(!c)break;n.unshift(c.name);cur=c.parent_id;}return n.join(' / ')};
  console.log('  分类数: '+cats.length);
  cats.filter(c=>c.is_active).forEach(c=>console.log('    ['+c.id+'] '+pathOf(c.id)));
  process.exit(0);
})();" 2>&1 | grep -v dotenv

echo
echo "=== 3. 重启并做一次真实审核（GLM 已配置则真调）==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
node -e "
require('dotenv').config();
const glm=require('./lib/glm');
(async()=>{
  // 找一个真实分类 id（Minecraft知识 或第一个）
  const db=require('./database');
  const cat=await db.get(\"SELECT id FROM wiki_categories WHERE is_active=1 ORDER BY id LIMIT 1\");
  console.log('  使用分类 id=' + (cat&&cat.id));
  const r=await glm.reviewContent({
    title:'红石计时器同步方案',
    summary:'介绍一种红石计时器的同步做法',
    content:'<p>本条目介绍用中继器与比较器实现红石计时器同步的两种方案，含数据表与适用场景说明。</p>',
    kind:'new',
    categoryId: cat && cat.id
  });
  console.log('  审核结果: ok='+r.ok+' decision='+r.decision+' score='+r.score+' 版本='+r.promptVersion);
  console.log('  categories='+JSON.stringify(r.categories));
  console.log('  reasons='+JSON.stringify(r.reasons).slice(0,300));
  process.exit(0);
})();" 2>&1 | grep -v dotenv | head -12

echo
echo "=== 4. 健康检查 ==="
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/
echo -n "  Wiki: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/wiki
