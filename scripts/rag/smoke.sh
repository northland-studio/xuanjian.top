#!/bin/bash
# 部署后冒烟：站点、问答、管理接口鉴权、前端产物
set -u
BASE=https://xuanjian.top
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  PASS $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL $1 ${2:-}"; }

echo "=== 站点与产物 ==="
H=$(curl -s --max-time 15 $BASE/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
echo "  产物: $H"
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 $BASE/)" = "200" ] && ok "首页 200" || bad "首页异常"

echo "=== 问答仍可用 ==="
rm -f /tmp/sm.txt
R=$(curl -s -c /tmp/sm.txt -b /tmp/sm.txt --max-time 90 -X POST "$BASE/api/faq/ask" -H 'Content-Type: application/json' --data-binary '{"question":"贡献点怎么获得"}')
echo "$R" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log('  ok='+j.ok+' 来源='+(j.sources||[]).length+' 长度='+String(j.answer||'').length);process.stdout.write(j.ok&&(j.sources||[]).length?'  PASS 问答正常\\n':'  FAIL 问答异常\\n')}catch(e){console.log('  解析失败 '+s.slice(0,120))}})"

echo "=== 管理接口鉴权 ==="
for p in status config; do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/api/faq/admin/$p")
  [ "$c" = "401" ] && ok "未登录 /admin/$p -> 401" || bad "未登录 /admin/$p 返回 $c"
done
c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X PUT "$BASE/api/faq/admin/config" -H 'Content-Type: application/json' --data-binary '{"config":{"rag.chunkSize":0}}')
[ "$c" = "401" ] && ok "未登录改配置 -> 401" || bad "未登录改配置返回 $c"

echo "=== 前端是否包含新设置面板 & 头像无姬字 ==="
JS="/var/www/xuanjian-guild/frontend/dist/$H"
printf '  分组文案: '; grep -c '检索与分块' "$JS" || true
printf '  未保存提示: '; grep -c '未保存' "$JS" || true
printf '  头像姬字残留（应为 0）: '; grep -c 'rag-avatar-fallback[^"]*"><i' "$JS" || true

echo "=== 结果：通过 $PASS / 失败 $FAIL ==="
