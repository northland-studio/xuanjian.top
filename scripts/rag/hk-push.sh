#!/bin/bash
# 在 HK 上：从 bundle 推到 GitHub（本机 DNS 被代理劫持，改由 HK 出网）
set -e
TOKEN="${GH_TOKEN:?缺少 GH_TOKEN}"
REPO="northland-studio/xuanjian.top"
WORK=/root/_push_xuanjian
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"
git clone -q --bare /root/_push.bundle repo.git
cd repo.git
git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${TOKEN}@github.com/${REPO}.git"
echo "本地 master: $(git rev-parse master)"
git push origin master 2>&1 | tail -2
echo "推送后远端: $(git ls-remote --heads origin master 2>/dev/null | awk '{print $1}')"
cd /root && rm -rf "$WORK"
