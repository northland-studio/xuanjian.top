#!/bin/bash
# 收尾：卸载不可用的 gamedraw、锁定 .env 权限、恢复空壳 bot.py，保留 NoneBot2 环境与隧道备用
set -e
DIR=/opt/xuanjian-gacha
cd "$DIR"

echo "=== 卸载跑不起来的 gamedraw（保留 NoneBot2 环境）==="
.venv/bin/pip uninstall -y -q nonebot-plugin-gamedraw 2>&1 | tail -2 || true
rm -rf vendor
.venv/bin/pip list 2>/dev/null | grep -iE 'nonebot|aiohttp|pillow' | head -6

echo "=== 恢复空壳 bot.py（只连 ws，不加载任何第三方插件）==="
cat > bot.py <<'PY'
"""玄剑抽卡机器人（NoneBot2 骨架）：与 TS 主机器人并行，仅群内娱乐，不涉及贡献点。

当前状态：环境与隧道已验证可用（能收到主群真实消息）；
现成 gamedraw 插件在 Python 3.12 上装不起来（Pillow 8.2.0 无 wheel + 缺 cn2an/apscheduler/pypinyin + 旧 pydantic API），
待自研最小抽卡插件后，在下方 load_plugins/load_plugin 处挂上即可。
"""
import nonebot
from nonebot.adapters.onebot.v11 import Adapter as OneBotV11Adapter

nonebot.init()
driver = nonebot.get_driver()
driver.register_adapter(OneBotV11Adapter)

# 只显式加载本目录 plugins/ 下的插件（绝不通配加载第三方包）
nonebot.load_plugins("plugins")

if __name__ == "__main__":
    nonebot.run()
PY
mkdir -p plugins

echo "=== 权限收敛 ==="
chmod 600 .env
ls -l .env bot.py

echo "=== 当前状态 ==="
ss -ltn 2>/dev/null | grep 13001 && echo "  隧道 13001 在线（备用）" || echo "  隧道未监听"
pm2 list | grep -E 'gacha|napcat' || true
du -sh "$DIR" 2>/dev/null
free -m | head -2
