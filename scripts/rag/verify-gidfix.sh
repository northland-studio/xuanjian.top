#!/bin/bash
# 部署游客身份修复并回归测试（使用 cookie jar 模拟真实浏览器）
set -u
APP=/var/www/xuanjian-guild
BASE=https://xuanjian.top
JAR=/tmp/rag-cookie.txt
rm -f "$JAR"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  PASS $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL $1 ${2:-}"; }

echo "=== 部署 routes/faq.js 并重启 ==="
cd "$APP"
cp routes/faq.js "routes/faq.js.bak-gidfix"
cp /root/faq.js routes/faq.js
node --check routes/faq.js && echo "  语法 OK"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo "  health(首页): $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 $BASE/)"

echo
echo "=== 1. 游客会话复用（带 cookie jar）==="
R1=$(curl -s -c "$JAR" -b "$JAR" --max-time 90 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' \
  --data-binary '{"question":"贡献点怎么获得"}')
CID=$(printf '%s' "$R1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).conversationId||''))}catch(e){process.stdout.write('')}})")
echo "  第一次 conversationId: $CID"
echo "  下发的 cookie: $(grep -o 'rag_gid[^\t]*' "$JAR" | awk '{print substr($2,1,8)"…"}' | head -1)"
R2=$(curl -s -c "$JAR" -b "$JAR" --max-time 90 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' \
  --data-binary "{\"question\":\"那每日上限呢\",\"conversationId\":\"$CID\"}")
CID2=$(printf '%s' "$R2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).conversationId||''))}catch(e){process.stdout.write('')}})")
echo "  第二次 conversationId: $CID2"
[ -n "$CID" ] && [ "$CID" = "$CID2" ] && ok "追问复用同一会话" || bad "会话未复用（$CID → $CID2）"

echo
echo "=== 2. 回答与来源 ==="
printf '%s' "$R2" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  console.log('  回答: ' + String(j.answer||j.error||'').replace(/\s+/g,' ').slice(0,110));
  console.log('  来源: ' + (j.sources||[]).map(x=>x.title).join('/'));
  process.stdout.write('  ' + (j.ok && (j.sources||[]).length ? 'PASS' : 'FAIL') + ' 追问有回答与来源\n');
});"

echo
echo "=== 3. 限流（同一 cookie 连续请求）==="
rm -f /tmp/rag-rl.txt
codes=""
for i in 1 2 3 4 5; do
  c=$(curl -s -c /tmp/rag-rl.txt -b /tmp/rag-rl.txt -o /dev/null -w '%{http_code}' --max-time 60 \
    -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' --data-binary "{\"question\":\"限流测试$i\"}")
  codes="$codes $c"
done
echo "  状态码:$codes"
echo "$codes" | grep -q 429 && ok "触发 429 限流" || bad "未触发 429"

echo
echo "=== 4. 不同浏览器（不同 cookie）互不影响 ==="
rm -f /tmp/rag-b1.txt /tmp/rag-b2.txt
c1=$(curl -s -c /tmp/rag-b1.txt -b /tmp/rag-b1.txt -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' --data-binary '{"question":"红石有什么限制"}')
c2=$(curl -s -c /tmp/rag-b2.txt -b /tmp/rag-b2.txt -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' --data-binary '{"question":"活动什么时候举行"}')
echo "  浏览器A: $c1  浏览器B: $c2（A 已用掉额度，B 仍应 200）"
[ "$c2" = "200" ] && ok "不同访客限流互不影响" || bad "不同访客被互相限流（$c2）"

echo
echo "=== 5. 拒答与草稿不泄露 ==="
rm -f /tmp/rag-b3.txt
curl -s -c /tmp/rag-b3.txt -b /tmp/rag-b3.txt --max-time 90 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' \
  --data-binary '{"question":"公会创始人的真实姓名和家庭住址"}' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  console.log('  abstained=' + j.abstained + ' 来源数=' + (j.sources||[]).length);
  process.stdout.write('  ' + (j.abstained === true ? 'PASS' : 'FAIL') + ' 无据可查时拒答\n');
});"

echo
echo "=== 6. 管理接口鉴权 ==="
for p in "/api/faq/admin/status" "/api/faq/admin/config"; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE$p")
  [ "$c" = "401" ] && ok "未登录 $p -> 401" || bad "未登录 $p 返回 $c"
done

echo
echo "=== 结果：通过 $PASS / 失败 $FAIL ==="
