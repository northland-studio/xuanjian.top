# 北域工作室服务器监控（Nezha 哪吒 V2）

## 拓扑

```
                        ┌──────────────────────────────────────┐
                        │ HK 主控 64.90.13.2                   │
                        │ Nezha Dashboard v2.7.0 (systemd)      │
                        │ 监听 :8008（面板 + Agent 上报）       │
                        │ https://monitor.xuanjian.top          │
                        │ 数据：/opt/nezha-dashboard/data/     │
                        └──────────────────┬───────────────────┘
                                           │ Agent 主动外连（无需节点开端口）
        ┌──────────────────┬───────────────┼────────────────┬──────────────────┐
        │                  │               │                │                  │
  HK 主控（官网）     Northland-Web    北域-4H8G        XBed 服务器        QQ 群机器人
  64.90.13.2         115.190.153.44   143.20.156.16   189.105.72.119    43.248.3.161:20043
```

## 组件

| 组件 | 位置 | 说明 |
|---|---|---|
| Dashboard | HK `/opt/nezha-dashboard` | systemd `nezha-dashboard`，Go 单二进制 + SQLite，常驻约 58MB |
| Agent | 每台 `/opt/nezha-agent` | systemd `nezha-agent`，约 16–25MB，主动连接 `64.90.13.2:8008` |
| 反代 | HK nginx | `monitor.xuanjian.top` → `127.0.0.1:8008`（Cloudflare 代理 TLS） |
| 静态下载 | HK nginx `/files/` | agent 二进制，方便新节点安装 |

## 面板访问

- 地址：<https://monitor.xuanjian.top/dashboard>
- 用户名：`admin`；密码见 HK `/root/nezha-admin.txt`（部署时随机生成，请自行修改为强密码）
- 前台：<https://monitor.xuanjian.top/>

## 常用维护（HK）

```bash
systemctl status nezha-dashboard        # 面板状态
systemctl restart nezha-dashboard       # 重启面板
journalctl -u nezha-dashboard -f        # 面板日志
sqlite3 /opt/nezha-dashboard/data/sqlite.db 'SELECT id,name FROM servers;'
cp -a /opt/nezha-dashboard/data /root/backups/nezha-$(date +%F)   # 备份（SQLite + 配置）
```

## 新增节点（示例）

```bash
curl -sL -o /tmp/agent.zip https://monitor.xuanjian.top/files/agent.zip
mkdir -p /opt/nezha-agent && cd /tmp
unzip -oq agent.zip -d /opt/nezha-agent || python3 -m zipfile -e agent.zip /opt/nezha-agent
chmod +x /opt/nezha-agent/nezha-agent
# config.yml：server: 64.90.13.2:8008，client_secret 取 HK config.yaml 的 agent_secret_key，uuid 用 uuidgen
systemctl enable --now nezha-agent
```

## 待办 / 建议

- [ ] 配置告警渠道（Telegram / 邮件 / Webhook）与服务器离线、CPU/内存/磁盘阈值规则（面板 → 通知 / 任务）
- [ ] 修改默认管理员密码，开启面板 2FA（如需要）
- [ ] 限制 8008 端口的公网来源（仅放行节点 IP + Cloudflare），或加 Cloudflare Access
- [ ] 群机器人服务器磁盘 97%（7.6G 用满），建议清理重复的 napcat 安装（/opt/napcat 与 /opt/napcat-admin 各约 0.5–2G）
- [ ] 可选：加 Tailscale/Headscale 组网，管理流量走内网
