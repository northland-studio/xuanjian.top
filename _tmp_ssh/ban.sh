#!/bin/bash
echo "=== 1. fail2ban / 封禁情况 ==="
command -v fail2ban-client >/dev/null && fail2ban-client status 2>/dev/null | head -6 || echo "  无 fail2ban"
fail2ban-client status sshd 2>/dev/null | head -8 || true
echo
echo "=== 2. iptables 里是否有 64.90.13.2（HK）==="
iptables -L -n 2>/dev/null | grep -E '64\.90\.13\.2|DROP|REJECT' | head -10
echo
echo "=== 3. sshd 日志里 HK 的最近失败/拒绝 ==="
grep -a '64.90.13.2' /var/log/auth.log 2>/dev/null | tail -6 | cut -c1-160
echo
echo "=== 4. sshd 配置限制 ==="
grep -E '^(MaxStartups|MaxAuthTries|MaxSessions|LoginGraceTime)' /etc/ssh/sshd_config | head -6
echo
echo "=== 5. 当前活跃 ssh 连接 ==="
ss -tnp 2>/dev/null | grep ':20043' | head -8