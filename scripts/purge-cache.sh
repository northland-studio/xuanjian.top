#!/bin/bash
# 清理 Cloudflare 边缘缓存（SSG 页面内容更新后调用）
#
# 需要环境变量（在服务器 .env 或 shell 里）：
#   CF_ZONE_ID      —— Cloudflare 区域 ID
#   CF_API_TOKEN    —— API Token，权限：Zone → Cache Purge
# 缺凭据时只提示不报错：SSG 产物本身带 10 分钟 max-age，最坏情况 10 分钟后自动更新。
#
# 用法：
#   bash scripts/purge-cache.sh                                  # 整站清理
#   bash scripts/purge-cache.sh "https://xuanjian.top/wiki/a,https://xuanjian.top/wiki/b"
set -e

URLS="${1:-}"

if [ -z "$CF_ZONE_ID" ] || [ -z "$CF_API_TOKEN" ]; then
  echo "[purge] 未配置 CF_ZONE_ID / CF_API_TOKEN，跳过主动清理（SSG 缓存最多 10 分钟自动过期）"
  [ -n "$URLS" ] && echo "[purge]   待清理：$URLS"
  exit 0
fi

if [ -z "$URLS" ]; then
  BODY='{"purge_everything":true}'
  echo "[purge] 整站清理……"
else
  BODY=$(printf '%s' "$URLS" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' \
    | python3 -c "import json,sys; print(json.dumps({'files':[l.strip() for l in sys.stdin if l.strip()]}))")
  echo "[purge] 清理指定 URL：$URLS"
fi

RESP=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$BODY")

echo "$RESP" | head -c 500
echo
echo "$RESP" | grep -q '"success":true' && echo "[purge] 清理成功 ✓" || { echo "[purge] 清理失败（见上方响应）"; exit 1; }
