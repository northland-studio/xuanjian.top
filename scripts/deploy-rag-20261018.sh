#!/bin/bash
# 玄剑姬 RAG 上线（20261018）
#
# 前置（本地已准备好并上传到 $STAGE）：
#   dist.tgz / dist-ssr.tgz        前端产物（dist 已注入入口自举脚本）
#   server-files.tgz               服务端文件（lib/rag、routes、lib/wiki.js、server.js、package.json、scripts）
#
# 步骤：备份 → 安装依赖 → 迁移 → 替换服务端文件 → 替换前端产物 → 重建 SSG → 配置 .env → 重启 → 健康检查
# 失败自动回滚（前端产物、服务端文件、pm2）
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-rag-20261018
TAG=20261018-rag

cd "$APP"

echo "[1/8] 备份数据库与现有产物..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
rm -rf "frontend/dist.bak-$TAG" "frontend/dist-ssr.bak-$TAG" "server.bak-$TAG"
cp -a frontend/dist "frontend/dist.bak-$TAG"
[ -d frontend/dist-ssr ] && cp -a frontend/dist-ssr "frontend/dist-ssr.bak-$TAG"
mkdir -p "server.bak-$TAG"
for f in "server.js" "package.json" "lib/wiki.js" "routes/faq.js" "routes/qqbot-rag.js"; do
  [ -f "$f" ] && mkdir -p "server.bak-$TAG/$(dirname "$f")" && cp -a "$f" "server.bak-$TAG/$f"
done
[ -d lib/rag ] && cp -a lib/rag "server.bak-$TAG/lib/rag"
echo "    备份完成 -> *.bak-$TAG"

rollback() {
  echo "[回滚] 恢复前端产物与服务端文件..."
  rm -rf frontend/dist frontend/dist-ssr
  [ -d "frontend/dist.bak-$TAG" ] && cp -a "frontend/dist.bak-$TAG" frontend/dist
  [ -d "frontend/dist-ssr.bak-$TAG" ] && cp -a "frontend/dist-ssr.bak-$TAG" frontend/dist-ssr
  [ -d "server.bak-$TAG" ] && cp -a "server.bak-$TAG/." .
  pm2 restart xuanjian-guild --update-env || true
  echo "[回滚] 完成，请检查日志：pm2 logs xuanjian-guild --lines 50"
}
trap 'echo "[失败] 触发回滚"; rollback; exit 1' ERR

echo "[2/8] 安装依赖（sqlite-vec）..."
npm install sqlite-vec --no-audit --no-fund --omit=dev 2>&1 | tail -3

echo "[3/8] 执行 RAG 迁移（幂等）..."
tar -xzf "$STAGE/server-files.tgz" -C .
node --check scripts/migrate-rag.js
node scripts/migrate-rag.js | tail -8

echo "[4/8] 配置 .env（幂等，已存在则跳过）..."
if ! grep -q '^RAG_SECRET_KEY=' .env 2>/dev/null || [ -z "$(grep '^RAG_SECRET_KEY=' .env | cut -d= -f2-)" ]; then
  KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "" >> .env
  echo "# 玄剑姬 RAG（$TAG 自动生成）" >> .env
  echo "RAG_SECRET_KEY=$KEY" >> .env
  echo "    已生成并写入 RAG_SECRET_KEY"
else
  echo "    RAG_SECRET_KEY 已存在，保持不变"
fi
for k in RAG_EMBEDDING_KEY RAG_LLM_KEY; do
  if ! grep -q "^$k=" .env 2>/dev/null; then
    echo "$k=" >> .env
    echo "    (!) 请手工填写 $k（或稍后在 /admin 玄剑姬 AI 里保存）"
  fi
done
chmod 600 .env

echo "[5/8] 替换前端产物..."
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new
[ -f frontend/dist.new/index.html ] || { echo "新产物缺少 index.html"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr
echo -n "    新产物: "; ls frontend/dist/assets/index-*.js | xargs -n1 basename | tr '\n' ' '; echo

echo "[6/8] 重建 SSG 静态页..."
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/rag-prerender.log 2>&1 || { echo "    (!) prerender 失败"; tail -5 /tmp/rag-prerender.log; }
tail -2 /tmp/rag-prerender.log || true

echo "[7/8] 重启并健康检查..."
pm2 restart xuanjian-guild --update-env
sleep 6
for u in "/" "/admin" "/wiki" "/api/health" "/api/wiki?limit=1"; do
  echo "    $u -> $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:4000$u")"
done
echo -n "    vector 扩展: "
node -e "require('sqlite3');const v=require('sqlite-vec');console.log(typeof v.getLoadablePath==='function'?v.getLoadablePath():'不可用')" 2>&1 | tail -1

echo "[8/8] RAG 状态核对..."
node -e "
const db=require('./database');
const vec=require('./lib/rag/vec');
(async()=>{
  await vec.load();
  const t=await db.get(\"SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'rag_%'\");
  console.log('    rag_* 对象数:', t.c, '| sqlite-vec:', vec.isReady()?vec.state.version:'不可用');
  const pub=await db.get(\"SELECT COUNT(*) c FROM wiki_pages WHERE status='published'\");
  const idx=await db.get(\"SELECT COUNT(*) c FROM rag_page_index WHERE status='indexed'\");
  const ch=await db.get('SELECT COUNT(*) c FROM rag_chunks');
  console.log('    已发布页面:', pub.c, '| 已索引:', idx.c, '| 分块:', ch.c);
  console.log('    下一步：管理员登录 /admin → 玄剑姬 AI → 索引管理 → 全量重建（约 ' + pub.c + ' 页）');
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
"

echo "上线完成 ✓"
echo "回滚：cp -a frontend/dist.bak-$TAG frontend/dist && cp -a server.bak-$TAG/. . && pm2 restart xuanjian-guild"
