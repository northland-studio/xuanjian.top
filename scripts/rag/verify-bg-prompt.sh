#!/bin/bash
# 验证新版 prompt（v4）与背景淡化上线效果
set -u
BASE=https://xuanjian.top
APP=/var/www/xuanjian-guild

ask() {
  curl -s --max-time 120 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' \
    --data-binary "$(node -e 'process.stdout.write(JSON.stringify({question:process.argv[1]}))' "$1")" \
  | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{
    const j=JSON.parse(s);
    console.log('  问：' + process.argv[1]);
    console.log('  答：' + String(j.answer||j.error||'').replace(/\s+/g,' ').slice(0,260));
    console.log('  来源：' + (j.sources||[]).map(x=>x.title).join('/') + ' | abstained=' + j.abstained);
    const emoji=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(j.answer||'');
    console.log('  含 emoji：' + (emoji ? '有（异常）' : '无'));
    console.log('');
  }catch(e){console.log('  解析失败: '+s.slice(0,150))}
});" "$1"
}

echo "=== 1. 人设（新版 prompt v4）==="
ask "你是谁"
ask "贡献点怎么获得"

echo "=== 2. 提示词版本落库 ==="
cd "$APP" && node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const r=await db.all(\"SELECT prompt_version, substr(question,1,16) q, abstained FROM rag_qa_logs ORDER BY id DESC LIMIT 3\");
  r.forEach(x=>console.log('  ' + x.prompt_version + ' | ' + x.q));
  process.exit(0);
})();"

echo "=== 3. 前端背景与淡化 ==="
CSS=$(ls frontend/dist/assets/index-*.css | head -1)
echo "  CSS: $(basename "$CSS")"
echo -n "  背景图 xjj1.png: "; grep -c 'xjj1.png' "$CSS"
echo -n "  亮色淡化值: "; grep -o 'rgba(255,255,255,\.\([0-9]*\)' "$CSS" | head -3 | tr '\n' ' '; echo
echo -n "  暗色淡化值: "; grep -o 'rgba(0,0,0,\.\([0-9]*\)' "$CSS" | head -3 | tr '\n' ' '; echo
echo -n "  头像仍用 xjj.png（JS 内）: "; grep -c 'cdn.xuanjian.top/xjj.png' frontend/dist/assets/index-*.js | head -1
