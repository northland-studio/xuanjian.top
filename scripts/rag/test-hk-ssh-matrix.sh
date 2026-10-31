#!/bin/bash
# 测试不同 KEX/加密组合，找出能走通 HK→bot 的参数（KEX 卡住通常是路径/MTU/算法问题）
H=root@43.248.3.161
K=/root/.ssh/id_napcat
BASE="-i $K -p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=12 -o BatchMode=yes"

try() {
  local name="$1"; shift
  local out
  out=$(timeout 20 ssh $BASE "$@" $H 'echo OK' 2>&1 | tail -2 | tr '\n' ' ')
  if echo "$out" | grep -q OK; then echo "  ✓ $name → 成功"; else echo "  ✗ $name → ${out:0:90}"; fi
}

echo "=== 尝试不同参数组合 ==="
try "默认" 
try "curve25519 + aes128-ctr" -o KexAlgorithms=curve25519-sha256 -o Ciphers=aes128-ctr -o MACs=hmac-sha2-256
try "group14 + aes128-ctr" -o KexAlgorithms=diffie-hellman-group14-sha256 -o Ciphers=aes128-ctr
try "关闭压缩 + 小包" -o KexAlgorithms=curve25519-sha256 -o Compression=no -o Ciphers=aes128-gcm@openssh.com
try "仅 ed25519 主机密钥" -o HostKeyAlgorithms=ssh-ed25519 -o KexAlgorithms=curve25519-sha256
try "IPQoS=throughput" -o IPQoS=throughput -o KexAlgorithms=curve25519-sha256

echo
echo "=== 路径 MTU 探测 ==="
ping -c 2 -M do -s 1400 43.248.3.161 2>&1 | tail -3
ping -c 2 -M do -s 1200 43.248.3.161 2>&1 | tail -3
