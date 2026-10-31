#!/bin/bash
# 签发测试令牌并重跑 OAuth 端到端测试
set -u
APP=/var/www/xuanjian-guild
cd "$APP"

TOKEN=$(node -e "
process.chdir('/var/www/xuanjian-guild');
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const jwt = require('/var/www/xuanjian-guild/node_modules/jsonwebtoken');
process.stdout.write(jwt.sign({ userId: 2, level: 1 }, process.env.JWT_SECRET, { expiresIn: '20m' }));
" 2>/dev/null)

echo "token 长度: ${#TOKEN}"
if [ -z "$TOKEN" ]; then echo "令牌签发失败"; exit 1; fi

node scripts/oauth-e2e.js "$TOKEN" 2>&1 | grep -v dotenv
