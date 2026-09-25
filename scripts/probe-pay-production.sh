#!/bin/bash
# 生产：二维码图片 + QQ 机器人支付接口探针（结束后清理探针产生的二维码）
cd /var/www/xuanjian-guild
B=http://127.0.0.1:3000
TOKEN=$(grep -E '^QQBOT_TOKEN=' .env | cut -d= -f2- | tr -d '\r')
QQ=$(sqlite3 data/guild.db "SELECT qq FROM users WHERE qq IS NOT NULL AND qq <> '' LIMIT 1")
MAXID=$(sqlite3 data/guild.db "SELECT COALESCE(MAX(id),0) FROM pay_intents")
echo "绑定 QQ 示例: ${QQ:-（无）} | 探针前 pay_intents 最大 id: $MAXID"

echo "--- qr.png ---"
echo "  合法链接:   $(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}B' "$B/api/pay/qr.png?text=https%3A%2F%2Fxuanjian.top%2Fpay%2Fabcdefghijklmnop")"
echo "  纯 token:   $(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$B/api/pay/qr.png?text=abcdefghijklmnop")"
echo "  任意文本:   $(curl -s -o /dev/null -w '%{http_code}' "$B/api/pay/qr.png?text=hello%20world")"
echo "  超长:       $(curl -s -o /dev/null -w '%{http_code}' "$B/api/pay/qr.png?text=$(printf 'a%.0s' $(seq 1 600))")"

echo "--- qqbot-pay 鉴权 ---"
echo "  无 token 出码: $(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/qqbot/pay/receive-code -H 'Content-Type: application/json' -d "{\"qq\":\"$QQ\"}")"
echo "  错 token 出码: $(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/qqbot/pay/receive-code -H 'X-Bot-Token: wrong-token' -H 'Content-Type: application/json' -d "{\"qq\":\"$QQ\"}")"
if [ -z "$TOKEN" ]; then echo "  (!) 未读到 QQBOT_TOKEN，跳过正例"; else
echo "--- qqbot-pay 正例（复用 bot token）---"
echo "  收款码:   $(curl -s -X POST $B/api/qqbot/pay/receive-code -H "X-Bot-Token: $TOKEN" -H 'Content-Type: application/json' -d "{\"qq\":\"$QQ\",\"amount\":5,\"note\":\"探针\"}" | head -c 260)"
echo
echo "  付款码:   $(curl -s -X POST $B/api/qqbot/pay/payer-code -H "X-Bot-Token: $TOKEN" -H 'Content-Type: application/json' -d "{\"qq\":\"$QQ\"}" | head -c 260)"
echo
echo "  记录:     $(curl -s -H "X-Bot-Token: $TOKEN" "$B/api/qqbot/pay/records?qq=$QQ&limit=2" | head -c 200)"
echo
echo "  未绑定QQ: $(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/qqbot/pay/receive-code -H "X-Bot-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"qq":"10000001"}')  (应为 404)"
echo "  缴费单(无权限账号): $(curl -s -X POST $B/api/qqbot/pay/charge -H "X-Bot-Token: $TOKEN" -H 'Content-Type: application/json' -d "{\"qq\":\"$QQ\",\"title\":\"探针缴费单\",\"amount\":1}" | head -c 160)"
echo
fi

echo "--- 清理探针二维码 ---"
sqlite3 data/guild.db "DELETE FROM pay_intents WHERE id > $MAXID AND kind IN ('receive','payer_code','charge');"
sqlite3 data/guild.db "DELETE FROM pay_payees WHERE id > (SELECT COALESCE(MAX(id),0) FROM pay_payees) - 0 AND type='event' AND display_name='探针缴费单';"
sqlite3 data/guild.db "SELECT '剩余 pay_intents: ' || COUNT(*) FROM pay_intents; SELECT '剩余 pay_charges: ' || COUNT(*) FROM pay_charges;"
