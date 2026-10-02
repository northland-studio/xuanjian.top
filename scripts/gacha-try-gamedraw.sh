#!/bin/bash
# 试装 gamedraw（原神抽卡）并观察首次数据初始化是否能成功
set -e
DIR=/opt/xuanjian-gacha
cd "$DIR"

echo "=== 1) 安装 nonebot-plugin-gamedraw（先试 PyPI，失败则从 GitHub 源码装）==="
if .venv/bin/pip install -q nonebot-plugin-gamedraw 2>/tmp/pip1.log; then
  echo "  ✓ 已从 PyPI 安装"
else
  echo "  PyPI 安装失败：$(tail -2 /tmp/pip1.log | tr '\n' ' ')"
  echo "  改用 GitHub 源码："
  mkdir -p vendor && cd vendor
  [ -d nonebot_plugin_gamedraw ] || git clone -q --depth 1 https://github.com/HibiKier/nonebot_plugin_gamedraw.git
  cd nonebot_plugin_gamedraw
  "$DIR/.venv/bin/pip" install -q -e . 2>/tmp/pip2.log || { echo "  源码安装失败：$(tail -3 /tmp/pip2.log | tr '\n' ' ')"; exit 1; }
  echo "  ✓ 已从源码安装"
  cd "$DIR"
fi
.venv/bin/pip list 2>/dev/null | grep -iE 'gamedraw|pillow|lxml|beautifulsoup|apscheduler' | head -8

echo "=== 2) 查插件默认配置项（游戏开关与路径）==="
PKG=$(.venv/bin/python -c "import importlib.util,os;print(os.path.dirname(importlib.util.find_spec('nonebot_plugin_gamedraw').origin))" 2>/dev/null || true)
if [ -z "$PKG" ] && [ -d vendor/nonebot_plugin_gamedraw ]; then PKG="$DIR/vendor/nonebot_plugin_gamedraw"; fi
echo "  插件目录: $PKG"
CONF=$(find "$PKG" -name 'config.py' | head -1)
grep -oE '^[A-Z0-9_]+_FLAG' "$CONF" 2>/dev/null | sort -u | head -12 || true
grep -oE '^DRAW_PATH|^GENSHIN_[A-Z_]+' "$CONF" 2>/dev/null | sort -u | head -12 || true
grep -nE 'bwiki|wiki' "$PKG"/draw_card/handles/base_handle.py 2>/dev/null | head -4 || true

echo "=== 3) 写配置：只开原神，其余游戏关闭 ==="
FLAGS=$(grep -oE '^[A-Z0-9_]+_FLAG' "$CONF" 2>/dev/null | sort -u)
{
  echo ""
  echo "# ---- gamedraw：只开原神，其余关闭（HK 磁盘 26G，仍不浪费）----"
  echo "DRAW_PATH=$DIR/data/draw_card"
  for f in $FLAGS; do
    if [ "$f" = "GENSHIN_FLAG" ]; then echo "$f=true"; else echo "$f=false"; fi
  done
} >> .env
echo "  已写入："; tail -12 .env | sed -E 's/(TOKEN=).*/\1****/'

echo "=== 4) 加载 gamedraw 跑 120 秒，观察首次数据初始化 ==="
cat > bot.py <<'PY'
"""玄剑抽卡机器人（NoneBot2）：与 TS 主机器人并行，仅群内娱乐，不涉及贡献点。"""
import nonebot
from nonebot.adapters.onebot.v11 import Adapter as OneBotV11Adapter

nonebot.init()
driver = nonebot.get_driver()
driver.register_adapter(OneBotV11Adapter)
nonebot.load_plugins("plugins")
nonebot.load_plugin("nonebot_plugin_gamedraw")

if __name__ == "__main__":
    nonebot.run()
PY
rm -f plugins/zz_probe.py
timeout 120 .venv/bin/python bot.py 2>&1 | tail -40 || true

echo "=== 5) 数据目录体积与内存 ==="
du -sh "$DIR/data" 2>/dev/null || echo "  data 目录不存在（初始化未产出）"
du -sh "$DIR/vendor" 2>/dev/null || true
free -m | head -2
echo "=== 完成 ==="
