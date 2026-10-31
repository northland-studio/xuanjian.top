#!/bin/bash
D=/opt/napcat-admin/qq/napcat/config
echo "=== 现有 onebot11 配置（对比玄剑姬用哪份）==="
for f in "$D"/onebot11_*.json; do
  echo "--- $(basename "$f") ---"
  head -c 600 "$f"
  echo
done
echo
echo "=== 管理号 UIN 判定（nt_qq 目录 + 最近修改的配置）==="
ls -lat "$D" | head -6
echo
echo "=== 玄剑姬实例的 onebot11 配置参照（端口 3001）==="
cat /opt/napcat/squashfs-root/napcat/config/onebot11_3073690475.json 2>/dev/null | head -c 700