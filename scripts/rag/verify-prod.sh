#!/bin/bash
# 玄剑姬生产环境验收测试
set -u
APP=/var/www/xuanjian-guild
BASE=https://xuanjian.top
PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1 ${2:-}"; }
check_code() { # $1=name $2=expect $3=actual
  [ "$2" = "$3" ] && ok "$1 ($3)" || bad "$1（期望 $2，实际 $3）"
}

echo "======== 1. 站点可用性 ========"
check_code "首页" 200 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 $BASE/)"
check_code "Wiki 列表" 200 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 $BASE/wiki)"
check_code "管理后台" 200 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 $BASE/admin)"
echo -n "  前端产物哈希: "; curl -s --max-time 15 $BASE/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1
echo -n "  前端是否含玄剑姬浮窗: "; curl -s --max-time 15 $BASE/ | grep -c 'rag-fab' || true

echo
echo "======== 2. 索引统计与一致性 ========"
cd "$APP" && node /root/prod-stats.js 2>&1 | sed 's/^/  /'

echo
echo "======== 3. 公开问答（游客）========"
ask() { # $1=问题
  curl -s --max-time 120 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' \
    --data-binary "$(printf '{"question":%s}' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")")"
}

R1=$(ask "加入公会需要满足什么条件")
echo "$R1" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{
    const j=JSON.parse(s);
    console.log('  ok=' + j.ok + ' abstained=' + j.abstained + ' 来源=' + (j.sources||[]).map(x=>x.title).join('/'));
    console.log('  回答: ' + String(j.answer||j.error||'').replace(/\s+/g,' ').slice(0,140));
    console.log('  引用: ' + JSON.stringify([...String(j.answer||'').matchAll(/\[(\d{1,2})\]/g)].map(m=>m[1])));
    console.log('  latencyMs=' + j.latencyMs + ' conversationId=' + (j.conversationId?'有':'无'));
    process.stdout.write('  RESULT ' + (j.ok && (j.sources||[]).length>0 ? 'PASS' : 'FAIL') + ' 有来源\n');
  }catch(e){console.log('  解析失败: '+s.slice(0,200));}
});"

R2=$(ask "公会创始人的真实姓名和家庭住址")
echo "$R2" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  console.log('  abstained=' + j.abstained + '  回答: ' + String(j.answer||'').replace(/\s+/g,' ').slice(0,110));
  process.stdout.write('  RESULT ' + (j.abstained === true ? 'PASS' : 'FAIL') + ' 应拒答\n');
});"

R3=$(ask "贡献点怎么获得")
echo "$R3" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  console.log('  来源=' + (j.sources||[]).map(x=>x.title).join('/'));
  process.stdout.write('  RESULT ' + (j.ok && (j.sources||[]).length>0 ? 'PASS' : 'FAIL') + ' 有来源\n');
});"

echo
echo "======== 4. 会话上下文 ========"
CID=$(echo "$R1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).conversationId||'')}catch(e){console.log('')}})")
if [ -n "$CID" ]; then
  R4=$(curl -s --max-time 120 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' \
    --data-binary "{\"question\":\"那保证金呢\",\"conversationId\":\"$CID\"}")
  echo "$R4" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  console.log('  追问 ok=' + j.ok + ' 会话复用=' + (j.conversationId === process.argv[1] ? '是' : '否'));
  console.log('  回答: ' + String(j.answer||j.error||'').replace(/\s+/g,' ').slice(0,110));
  process.stdout.write('  RESULT ' + (j.ok ? 'PASS' : 'FAIL') + ' 追问可用\n');
});" "$CID"
else
  echo "  FAIL 未取得 conversationId"
fi

echo
echo "======== 5. 伪造他人会话 ========"
if [ -n "$CID" ]; then
  R5=$(curl -s --max-time 120 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' \
    --data-binary "{\"question\":\"这条会话是谁的\",\"conversationId\":\"$CID\"}")
  echo "$R5" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  process.stdout.write('  RESULT ' + (j.conversationId && j.conversationId !== process.argv[1] ? 'PASS' : 'FAIL') + ' 他人会话不被复用\n');
});" "$CID"
fi

echo
echo "======== 6. 机器人专用接口鉴权 ========"
CODE_NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$BASE/api/qqbot/rag/ask" -H 'Content-Type: application/json' --data-binary '{"question":"测试","userId":"1","groupId":"1"}')
check_code "无 Bot-Token 应 401" 401 "$CODE_NOAUTH"

CODE_BADTOKEN=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$BASE/api/qqbot/rag/ask" -H 'Content-Type: application/json' -H 'X-Bot-Token: wrong-token' --data-binary '{"question":"测试","userId":"1","groupId":"1"}')
check_code "错误 Bot-Token 应 401" 401 "$CODE_BADTOKEN"

BOT_TOKEN=$(grep -E '^QQBOT_TOKEN=' "$APP/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -n "$BOT_TOKEN" ]; then
  RB=$(curl -s --max-time 120 -X POST "$BASE/api/qqbot/rag/ask" -H 'Content-Type: application/json' -H "X-Bot-Token: $BOT_TOKEN" \
    --data-binary '{"question":"入会需要什么条件","userId":"10001","groupId":"860336849"}')
  echo "$RB" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{
    const j=JSON.parse(s);
    const leak = /diagnostic|vectorCount|rrfScore|subject_hash/.test(s);
    console.log('  ok=' + j.ok + ' 来源=' + (j.sources||[]).map(x=>x.title).join('/'));
    console.log('  回答: ' + String(j.answer||j.error||'').replace(/\s+/g,' ').slice(0,120));
    process.stdout.write('  RESULT ' + (j.ok && !leak ? 'PASS' : 'FAIL') + ' 机器人接口正常且无诊断泄露\n');
  }catch(e){console.log('  解析失败: '+s.slice(0,160));}
});"
else
  echo "  SKIP 未找到 QQBOT_TOKEN"
fi

echo
echo "======== 7. 管理接口鉴权 ========"
for p in "/api/faq/admin/status" "/api/faq/admin/config" "/api/faq/admin/index"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE$p")
  check_code "未登录访问 $p 应 401" 401 "$CODE"
done
CODE_SUPER=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$BASE/api/faq/admin/rebuild" -H 'Content-Type: application/json' --data-binary '{}')
check_code "未登录触发全量重建应 401" 401 "$CODE_SUPER"

echo
echo "======== 8. 草稿/归档不得泄露 ========"
curl -s --max-time 60 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' \
  --data-binary '{"question":"有没有还没发布的草稿制度"}' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  const titles=(j.sources||[]).map(x=>x.title);
  const badPage=titles.some(t=>/草稿|归档|未发布/.test(t));
  process.stdout.write('  RESULT ' + (!badPage ? 'PASS' : 'FAIL') + ' 来源不含草稿/归档（' + titles.join('/') + '）\n');
});"

echo
echo "======== 9. 限流生效 ========"
codes=""
for i in 1 2 3 4 5 6 7; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' --data-binary "{\"question\":\"限流测试$i\"}")
  codes="$codes $c"
done
echo "  连续 7 次状态码:$codes"
echo "$codes" | grep -q 429 && ok "触发 429 限流" || bad "未触发 429（可能被 nginx 或限流参数影响）"

echo
echo "======== 结果：通过 $PASS / 失败 $FAIL ========"
