#!/bin/bash
# 机器人服务器：验证 RAG 调用链与运行状态
APP=/var/www/xuanjian-group-bot
cd "$APP"

echo "=== 1. RAG 环境变量 ==="
grep -E '^RAG_' .env

echo "=== 2. 用机器人自己的 Bot-Token 调官网 RAG 接口 ==="
TOKEN=$(grep -E '^OFFICIAL_BOT_TOKEN=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
BASE=$(grep -E '^OFFICIAL_API_BASE=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")
echo "  官网: $BASE  Token 长度: ${#TOKEN}"
RESP=$(curl -s --max-time 90 -X POST "$BASE/api/qqbot/rag/ask" \
  -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" \
  --data-binary '{"question":"入会需要什么条件","userId":"10001","groupId":"860336849","isPrivate":false}')
echo "$RESP" | head -c 900
echo
echo "$RESP" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{
    const j=JSON.parse(s);
    console.log('  ok=' + j.ok + ' abstained=' + j.abstained + ' 来源=' + (j.sources||[]).map(x=>x.title).join('/'));
    const leak = /vectorCount|rrfScore|subject_hash|diagnostic/i.test(s);
    console.log('  诊断泄露: ' + (leak ? '有（异常）' : '无'));
    process.stdout.write('  RESULT ' + (j.ok && !leak ? 'PASS' : 'FAIL') + ' 机器人接口可用\\n');
  }catch(e){ console.log('  解析失败: ' + s.slice(0,200)); }
});"

echo "=== 3. 无 Token 应 401 ==="
echo -n "  HTTP: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 -X POST "$BASE/api/qqbot/rag/ask" -H 'Content-Type: application/json' --data-binary '{"question":"x","userId":"1","groupId":"1"}'

echo "=== 4. 服务状态与最近日志 ==="
systemctl is-active xuanjian-group-bot
journalctl -u xuanjian-group-bot --since '3 minutes ago' --no-pager 2>/dev/null | grep -viE 'pay\]' | tail -12
