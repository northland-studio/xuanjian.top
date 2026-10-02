#!/bin/bash
# 生产验证：帮助卡片接口（POST 生成 → GET 取图）
cd /var/www/xuanjian-guild
B=http://127.0.0.1:3000
TOKEN=$(python3 - <<'PY'
import re
for l in open('/var/www/xuanjian-guild/.env', encoding='utf-8'):
    m = re.match(r'\s*QQBOT_TOKEN\s*=\s*(.+)$', l)
    if m: print(m.group(1).strip()); break
PY
)
echo "token 长度 ${#TOKEN}"

cat > /tmp/help.json <<'JSON'
{"title":"玄剑公会群机器人 · 指令总览","subtitle":"共 8 条示例 · 前缀 # 或 / 均可",
 "groups":[
  {"name":"查询","items":[
    {"name":"档案","aliases":["chakan","我的档案"],"desc":"查看自己的档案与贡献点"},
    {"name":"在线","aliases":["zaixian"],"desc":"查看服务器在线情况"},
    {"name":"服务器","aliases":["115"],"desc":"十一服状态：人数/版本/TPS"}]},
  {"name":"经济","items":[
    {"name":"收款码","aliases":["qr","收款"],"desc":"生成我的收款码（90 秒）"},
    {"name":"缴费单","aliases":["charge","收费"],"desc":"创建缴费单并出海报图"},
    {"name":"月报","aliases":["monthly"],"desc":"财务对账海报（管理员）"}]},
  {"name":"审批","items":[
    {"name":"审批","aliases":["shenpi"],"desc":"列出待审批的大额支付"},
    {"name":"通过","aliases":["同意"],"desc":"审批通过一笔大额支付"}]}
 ]}
JSON

echo "=== POST 生成 ==="
RESP=$(curl -s -X POST $B/api/qqbot/pay/help-card -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" --data-binary @/tmp/help.json)
echo "$RESP" | head -c 300; echo
URL=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('url',''))")
echo "  图片地址: $URL"
LOCAL=${URL/https:\/\/xuanjian.top/$B}
echo "=== GET 取图 ==="
curl -s -o /tmp/help-card.png -w "  %{http_code} %{content_type} %{size_download}B\n" "$LOCAL"
file /tmp/help-card.png
echo "=== 幂等（同内容 hash 相同）==="
curl -s -X POST $B/api/qqbot/pay/help-card -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" --data-binary @/tmp/help.json | python3 -c "import json,sys;d=json.load(sys.stdin);print('  hash=',d.get('hash'),'count=',d.get('count'))"
echo "=== 边界 ==="
echo "  无 token: $(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/qqbot/pay/help-card -H 'Content-Type: application/json' -d '{}')"
echo "  空 groups: $(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/qqbot/pay/help-card -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" -d '{}')"
echo "  不存在 hash: $(curl -s -o /dev/null -w '%{http_code}' $B/api/qqbot/pay/help-card/deadbeefdeadbeef.png)"
ls -la data/help-cards/ | head -5
