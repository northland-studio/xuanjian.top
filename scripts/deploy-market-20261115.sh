#!/bin/bash
# 集市 market.* 权限增量部署（可回滚）：仅替换后端文件，无数据库迁移
# 用法：bash /root/perm-market-deploy/deploy-market.sh <TAG>
set -uo pipefail
TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
APP=/var/www/xuanjian-guild
SRC=/root/perm-market-deploy
STAGE="$SRC/stage"
BK="$APP/.bak-market-$TAG"
DBBK="/root/backups/market-$TAG"
PORT="$(grep -E '^PORT=' "$APP/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '\r')"
PORT="${PORT:-3000}"
mkdir -p "$BK" "$DBBK"
exec > >(tee -a "$SRC/deploy-$TAG.log") 2>&1

echo "======== 集市 market.* 权限增量部署 TAG=$TAG ========"
fail() { echo "✘ $1"; }

rollback() {
    echo "!!! 回滚 !!!"
    cd "$APP" || return 1
    if [ -d "$BK/files" ]; then
        (cd "$BK/files" && find . -type f | sed 's|^\./||') | while IFS= read -r f; do
            cp -a "$BK/files/$f" "$APP/$f"
        done
    fi
    pm2 restart xuanjian-guild >/dev/null 2>&1 || true
    sleep 3
    curl -s -o /dev/null -w "回滚后 /market HTTP=%{http_code}\n" "http://127.0.0.1:$PORT/market"
    echo "!!! 回滚完成 !!!"
}

rm -rf "$STAGE"; mkdir -p "$STAGE"
tar xzf "$SRC/market-deploy.tar.gz" -C "$STAGE" || { fail 解包失败; exit 1; }
echo "[1/6] 语法检查"
while IFS= read -r f; do node --check "$STAGE/$f" || { fail "语法失败 $f"; exit 1; }; done < <(cd "$STAGE" && find . -name '*.js' | sed 's|^\./||')
echo "[2/6] 备份将被替换文件 + 数据库快照"
cd "$APP" || exit 1
node "$SRC/perm-dbbackup.js" "$DBBK/guild.db.bak" || { fail DB备份失败; exit 1; }
mkdir -p "$BK/files"
while IFS= read -r f; do
    mkdir -p "$BK/files/$(dirname "$f")"
    [ -e "$APP/$f" ] && cp -a "$APP/$f" "$BK/files/$f"
done < <(cd "$STAGE" && find . -type f | sed 's|^\./||')
echo "[3/6] 安装文件"
while IFS= read -r f; do
    mkdir -p "$APP/$(dirname "$f")"
    cp -a "$STAGE/$f" "$APP/$f" || { fail "安装失败 $f"; rollback; exit 1; }
done < <(cd "$STAGE" && find . -type f | sed 's|^\./||')
echo "[4/6] 重启 pm2（注册表在首个请求时幂等同步：market.* → ACTIVE）"
pm2 restart xuanjian-guild --update-env || { fail "pm2 restart 失败"; rollback; exit 1; }
sleep 5
echo "[5/6] 验证"
cp "$SRC/perm-market-verify.js" "$APP/.perm-market-verify.js"
node "$APP/.perm-market-verify.js"
RC=$?
rm -f "$APP/.perm-market-verify.js"
if [ "$RC" != 0 ]; then fail "验证未通过"; rollback; exit 1; fi
echo "[6/6] 完成"
echo "✔ market.* 权限增量部署成功 TAG=$TAG"
echo "  文件备份：$BK/files  数据库备份：$DBBK/guild.db.bak  日志：$SRC/deploy-$TAG.log"
echo "  回滚：cp -a $BK/files/* $APP/ + pm2 restart xuanjian-guild"
