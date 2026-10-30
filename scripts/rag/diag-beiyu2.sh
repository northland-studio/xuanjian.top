#!/bin/bash
# beiyu：逐项验证五类错误的根因
set -u
APP=/var/www/beiyu-website
cd "$APP"

echo "=== A. 缺图：代码里哪里引用了 北域抠图98.png ==="
grep -rn --include='*.tsx' --include='*.ts' --include='*.jsx' --include='*.js' '北域抠图98' .next/static 2>/dev/null | head -3
grep -rln --include='*.tsx' --include='*.ts' '北域抠图' src app components 2>/dev/null | head -5
echo "  --- public 目录里实际有什么（含抠图/图片类）---"
ls public/ 2>/dev/null | head -20
echo "  --- 文件总数 ---"
ls public/ 2>/dev/null | wc -l

echo
echo "=== B. Server Action 失败：构建产物与源码是否一致 ==="
echo -n "  .next 构建时间: "; stat -c '%y' .next/BUILD_ID 2>/dev/null || echo '无 BUILD_ID'
echo -n "  BUILD_ID: "; cat .next/BUILD_ID 2>/dev/null || echo '无'
echo -n "  src/app 最新改动: "; find src app -name '*.tsx' -o -name '*.ts' 2>/dev/null | xargs ls -t 2>/dev/null | head -1 | xargs stat -c '%y' 2>/dev/null || echo '无'
echo "  --- 进程启动时间（对比构建时间）---"
pm2 describe beiyu 2>/dev/null | grep -E 'uptime|created at' | head -3

echo
echo "=== C. FormData 解析失败：请求来源 ==="
pm2 logs beiyu --err --lines 300 --nostream 2>/dev/null | grep -a -B2 'Failed to parse body as FormData' | head -8

echo
echo "=== D. SMTP 认证测试（用真实配置）==="
if [ -f .env ]; then
  USER=$(grep '^SMTP_USER=' .env | cut -d= -f2- | tr -d '"')
  PASS=$(grep '^SMTP_PASS=' .env | cut -d= -f2- | tr -d '"')
  HOST=$(grep -E '^SMTP_HOST=' .env | cut -d= -f2- | tr -d '"')
  PORT=$(grep -E '^SMTP_PORT=' .env | cut -d= -f2- | tr -d '"')
  echo "  HOST=${HOST:-未设置(默认?)} PORT=${PORT:-未设置} USER=$USER"
  node -e "
  const nodemailer=require('nodemailer');
  const t=nodemailer.createTransport({host:'${HOST:-smtp.exmail.qq.com}',port:${PORT:-465},secure:${PORT:-465}==465,auth:{user:'$USER',pass:'$PASS'}});
  t.verify().then(()=>{console.log('  ✓ SMTP 认证成功');process.exit(0)}).catch(e=>{console.log('  ✗ SMTP 认证失败: '+e.message);process.exit(0)});
  " 2>&1 | head -3
fi

echo
echo "=== E. 站点健康检查 ==="
for u in https://beiyu.xuanjian.top/ https://xuanjian.top/beiyu/; do
  echo -n "  $u -> "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "$u" 2>/dev/null || echo fail
done
