#!/bin/bash
# 前端一键构建（客户端 + SSR 产物）
#
# 客户端产物 frontend/dist       —— 纯 SPA，静态托管（入口已注入 Rocket Loader 免疫自举脚本）
# 服务端产物 frontend/dist-ssr   —— SSR/SSG 用，依赖已内联，单文件即可部署
#
# 用法：bash scripts/build-frontend.sh
set -e
cd "$(dirname "$0")/.."

echo "[1/3] 构建客户端产物（vite build）"
(cd frontend && npm run build)

echo "[2/3] 注入 Rocket Loader 免疫自举脚本"
node scripts/patch-index-bootstrap.js frontend/dist

echo "[3/3] 构建 SSR 产物（vite build --ssr）"
(cd frontend && npm run build:ssr)

echo "构建完成："
ls -lh frontend/dist/index.html | awk '{print "  " $NF, $5}'
ls -lh frontend/dist-ssr/entry-server.js | awk '{print "  " $NF, $5}'
echo "（SSG 静态页在服务器上执行：node scripts/prerender.js）"
