#!/bin/bash
# 权限组体系升级 —— 生产部署脚本（可回滚）
# 用法：bash /root/perm-deploy/deploy-permissions.sh <TAG>
# 前置：/root/perm-deploy/perm-deploy.tar.gz 已上传（仅权限升级文件，不含 GIS 未上线改动）
set -uo pipefail

TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
APP=/var/www/xuanjian-guild
SRC=/root/perm-deploy
STAGE="$SRC/stage"
BK="$APP/.bak-perm-$TAG"
DBBK="/root/backups/perm-$TAG"
PORT="$(grep -E '^PORT=' "$APP/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '\r')"
PORT="${PORT:-3000}"
ADDED="$BK/ADDED_FILES.txt"

mkdir -p "$BK" "$DBBK"
exec > >(tee -a "$SRC/deploy-$TAG.log") 2>&1

echo "=================================================="
echo "权限升级部署  TAG=$TAG"
echo "APP=$APP  PORT=$PORT"
echo "=================================================="

fail() { echo "✘ $1"; }

# ---------- 回滚 ----------
rollback() {
    echo "=================================================="
    echo "!!! 部署失败，开始回滚 !!!"
    cd "$APP" || return 1
    # 1) 删除本次新增的文件
    if [ -f "$ADDED" ]; then
        while IFS= read -r f; do [ -n "$f" ] && rm -f "$APP/$f"; done < "$ADDED"
    fi
    # 2) 还原被覆盖的文件
    if [ -d "$BK/lib" ] || [ -d "$BK/routes" ] || [ -f "$BK/server.js" ]; then
        (cd "$BK" && find . -type f \
            -not -name 'ADDED_FILES.txt' \
            -not -path './frontend-dist/*' | sed 's|^\./||') | while IFS= read -r f; do
            cp -a "$BK/$f" "$APP/$f"
        done
    fi
    # 3) 还原前端 dist / dist-ssr
    if [ -d "$BK/frontend-dist" ]; then
        rm -rf "$APP/frontend/dist"
        cp -a "$BK/frontend-dist" "$APP/frontend/dist"
    fi
    if [ -d "$BK/frontend-dist-ssr" ]; then
        rm -rf "$APP/frontend/dist-ssr"
        cp -a "$BK/frontend-dist-ssr" "$APP/frontend/dist-ssr"
    fi
    # 4) 还原数据库（先停进程避免 WAL 写入）
    pm2 stop xuanjian-guild >/dev/null 2>&1 || true
    sleep 1
    if [ -f "$DBBK/guild.db.bak" ]; then
        cp -a "$DBBK/guild.db.bak" "$APP/data/guild.db"
        rm -f "$APP/data/guild.db-wal" "$APP/data/guild.db-shm"
        echo "已还原数据库：$DBBK/guild.db.bak"
    else
        echo "警告：未找到数据库备份，数据库未还原（权限迁移只新增表/列，旧代码可正常运行）"
    fi
    pm2 start xuanjian-guild >/dev/null 2>&1 || pm2 restart xuanjian-guild >/dev/null 2>&1 || true
    sleep 4
    curl -s -o /dev/null -w "回滚后首页 HTTP=%{http_code}\n" "http://127.0.0.1:$PORT/"
    echo "回滚命令（手工复现）：cp -a $BK/... + 还原 $DBBK/guild.db.bak + pm2 restart xuanjian-guild"
    echo "!!! 回滚完成 !!!"
    echo "=================================================="
}

# ---------- 1. 解包 & 语法检查 ----------
rm -rf "$STAGE"; mkdir -p "$STAGE"
tar xzf "$SRC/perm-deploy.tar.gz" -C "$STAGE" || { fail "解包失败"; exit 1; }
echo "[1/8] 语法检查（node --check，仅后端 .js）..."
SYNTAX_FAIL=0
while IFS= read -r f; do
    case "$f" in frontend/*) continue ;; esac
    if ! node --check "$STAGE/$f"; then SYNTAX_FAIL=1; fi
done < <(cd "$STAGE" && find . -name '*.js' | sed 's|^\./||')
[ "$SYNTAX_FAIL" = 0 ] || { fail "语法检查未通过，终止（未改动生产）"; exit 1; }
echo "  语法检查通过"

# ---------- 2. 部署前备份：DB 一致快照 + 计数 ----------
echo "[2/8] 数据库一致备份（VACUUM INTO）与部署前计数..."
cd "$APP" || exit 1
node "$SRC/perm-dbbackup.js" "$DBBK/guild.db.bak" || { fail "数据库备份失败，终止"; exit 1; }
node "$SRC/perm-counts.js" > "$DBBK/counts-before.json" || { fail "部署前计数失败，终止"; exit 1; }
echo "  部署前计数：$(cat "$DBBK/counts-before.json")"

# ---------- 3. 备份将被覆盖/新增的文件 ----------
echo "[3/8] 备份将被替换的文件 → $BK"
while IFS= read -r f; do
    case "$f" in frontend/dist/*|frontend/dist-ssr/*) continue ;; esac
    if [ -e "$APP/$f" ]; then
        mkdir -p "$BK/$(dirname "$f")"
        cp -a "$APP/$f" "$BK/$f"
    else
        echo "$f" >> "$ADDED"
    fi
done < <(cd "$STAGE" && find . -type f | sed 's|^\./||')
cp -a "$APP/frontend/dist" "$BK/frontend-dist"
if [ -d "$APP/frontend/dist-ssr" ]; then cp -a "$APP/frontend/dist-ssr" "$BK/frontend-dist-ssr"; fi
echo "  备份完成（新增文件 $(wc -l < "$ADDED" 2>/dev/null || echo 0) 个）"

# ---------- 4. 安装文件 ----------
echo "[4/8] 安装后端文件与前端构建产物..."
while IFS= read -r f; do
    case "$f" in frontend/dist/*|frontend/dist-ssr/*) continue ;; esac
    mkdir -p "$APP/$(dirname "$f")"
    cp -a "$STAGE/$f" "$APP/$f" || { fail "文件安装失败: $f"; rollback; exit 1; }
done < <(cd "$STAGE" && find . -type f | sed 's|^\./||')
rm -rf "$APP/frontend/dist" "$APP/frontend/dist-ssr"
cp -a "$STAGE/frontend/dist" "$APP/frontend/dist" || { fail "前端 dist 安装失败"; rollback; exit 1; }
cp -a "$STAGE/frontend/dist-ssr" "$APP/frontend/dist-ssr" || { fail "前端 dist-ssr 安装失败"; rollback; exit 1; }
echo "  安装完成"

# ---------- 5. 迁移：dry-run → 实跑（带备份） ----------
echo "[5/8] 数据库迁移 dry-run..."
cd "$APP" || { rollback; exit 1; }
node migrations/run.js --dry-run || { fail "迁移 dry-run 失败"; rollback; exit 1; }
echo "[6/8] 执行数据库迁移（迁移器会再备份一次数据库）..."
MIG_OUT="$(node migrations/run.js --backup 2>&1)"
MIG_RC=$?
echo "$MIG_OUT"
[ "$MIG_RC" = 0 ] || { fail "数据库迁移失败"; rollback; exit 1; }
MIG_BAK="$(echo "$MIG_OUT" | grep -oE "$APP/data/backups/[^ ]+\.db" | tail -1)"
[ -n "$MIG_BAK" ] && [ -f "$MIG_BAK" ] && cp -a "$MIG_BAK" "$DBBK/guild.db.after-migration.bak"

# ---------- 6. 部署后计数与不变量核对 ----------
echo "[7/8] 迁移后计数与不变量核对..."
node "$SRC/perm-counts.js" > "$DBBK/counts-after.json" || { fail "迁移后计数失败"; rollback; exit 1; }
echo "  迁移后计数：$(cat "$DBBK/counts-after.json")"
BEFORE="$(cat "$DBBK/counts-before.json")"
AFTER="$(cat "$DBBK/counts-after.json")"
node - "$BEFORE" "$AFTER" <<'NODE' || { fail "迁移前后不变量不一致"; rollback; exit 1; }
const b = JSON.parse(process.argv[2]);
const a = JSON.parse(process.argv[3]);
const keys = [
    ['users', '用户数'],
    ['totalContribution', '贡献点合计'],
    ['wikiPages', 'wiki_pages'],
    ['marketStoreLocations', 'market_store_locations'],
    ['contributionLogs', '贡献点流水数']
];
let bad = 0;
for (const [k, label] of keys) {
    const same = JSON.stringify(b[k]) === JSON.stringify(a[k]);
    console.log(`  ${same ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(b[k])} → ${JSON.stringify(a[k])}`);
    if (!same) bad++;
}
if (!(a.permissionRoles >= 9)) { console.log(`  FAIL 系统角色数 ${a.permissionRoles} < 9`); bad++; }
else console.log(`  PASS 系统角色数 ${a.permissionRoles}`);
if (!(a.economyMemberCount > 0)) { console.log('  FAIL 经济成员为 0'); bad++; }
else console.log(`  PASS 经济成员 ${a.economyMemberCount}，经济账户 ${a.economyAccounts}，审计 ${a.auditLogs}`);
if (a.integrity !== 'ok') { console.log('  FAIL integrity_check=' + a.integrity); bad++; }
else console.log('  PASS integrity_check=ok');
process.exit(bad ? 1 : 0);
NODE

# ---------- 7. 重启 & 验证 ----------
echo "[8/8] 重启 pm2 并验证接口..."
pm2 restart xuanjian-guild --update-env || { fail "pm2 restart 失败"; rollback; exit 1; }
sleep 5
pm2 describe xuanjian-guild | grep -E 'status|restarts' | head -3
cp "$SRC/perm-verify.js" "$APP/.perm-verify.js"
node "$APP/.perm-verify.js"
VERIFY_RC=$?
rm -f "$APP/.perm-verify.js"
if [ "$VERIFY_RC" != 0 ]; then
    fail "接口/数据验证未通过"
    rollback
    exit 1
fi

echo "=================================================="
echo "✔ 权限升级部署成功  TAG=$TAG"
echo "  回滚代码备份：$BK"
echo "  数据库备份：$DBBK/guild.db.bak"
echo "  日志：$SRC/deploy-$TAG.log"
echo "  回滚：代码 cp -a $BK/* 回 $APP（或按日志 rollback 段命令）+ 还原 $DBBK/guild.db.bak + pm2 restart xuanjian-guild"
echo "=================================================="
