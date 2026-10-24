#!/bin/bash
# 部署玄剑姬人设提示词（lib/rag/ask.js）并做真实问答抽查
set -e
APP=/var/www/xuanjian-guild
cd "$APP"

cp lib/rag/ask.js "lib/rag/ask.js.bak-promptv3"
cp /root/ask.js lib/rag/ask.js
node --check lib/rag/ask.js
echo "  语法 OK，提示词版本：$(grep -o "rag-prompt-v[0-9]*" lib/rag/ask.js | head -1)"

pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo "  首页: $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://xuanjian.top/)"

ask() {
  rm -f /tmp/a.txt
  curl -s -c /tmp/a.txt -b /tmp/a.txt --max-time 120 -X POST https://xuanjian.top/api/faq/ask \
    -H 'Content-Type: application/json' \
    --data-binary "$(node -e 'process.stdout.write(JSON.stringify({question:process.argv[1]}))' "$1")" \
  | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  console.log('  问：' + process.argv[1]);
  console.log('  答：' + String(j.answer||j.error||'').replace(/\n/g,' ⏎ ').slice(0,320));
  console.log('  abstained=' + j.abstained + ' 来源=' + (j.sources||[]).map(x=>x.title).join('/'));
  console.log('');
});" "$1"
}

ask "贡献点怎么获得"
ask "糖醋排骨好吃吗"
ask "公会创始人的家庭住址"

echo "=== 最近的提示词版本落库 ==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const rows=await db.all('SELECT prompt_version, status, abstained, substr(question,1,24) q FROM rag_qa_logs ORDER BY id DESC LIMIT 4');
  rows.forEach(r=>console.log('  ' + r.prompt_version + ' ' + r.status + ' abstained=' + r.abstained + ' | ' + r.q));
  process.exit(0);
})();
"
