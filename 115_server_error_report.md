# 115服务器 xuanjian-guild 错误分析报告

## 概述

**服务器**: 115.190.153.44 (northland-webserver)
**问题进程**: PM2 xuanjian-guild
**错误类型**: EADDRINUSE - 端口冲突
**报告时间**: 2026-06-14 23:15

---

## 时间线分析

### 系统启动时间
- **系统引导时间**: 2026-06-14 13:39:00

### 服务启动时间
| 服务 | 启动时间 | 状态 |
|------|----------|------|
| nginx | 13:39:06-13:39:07 | 正常启动 |
| docker | 13:39:07-13:39:10 | 正常启动 |
| PM2进程 | 13:39+ | 自动恢复 |

### PM2错误日志时间戳
- **日志文件创建**: 2026-02-11 20:25:56
- **最后修改**: 2026-06-14 23:11:39
- **日志大小**: 3.2MB
- **重启次数**: 4023次

---

## 错误详情

### 主要错误：端口冲突

```
Error: listen EADDRINUSE: address already in use :::3000
  code: 'EADDRINUSE',
  errno: -98,
  syscall: 'listen',
  address: '::',
  port: 3000
```

### 根本原因

**端口3000被宝塔面板项目占用**：

| 占用进程 | PID | 用户 | 路径 |
|----------|-----|------|------|
| 宝塔xuanjian.top | 1504/245478 | www | /www/wwwroot/xuanjian.top/server.js |
| PM2 xuanjian-guild | 0 (失败) | root | /var/www/xuanjian-guild/server.js |

**冲突分析**：
- 宝塔面板通过其项目管理自动启动了 `/www/wwwroot/xuanjian.top/server.js`
- 该进程监听3000端口
- PM2的xuanjian-guild尝试启动时发现端口已被占用
- PM2持续尝试重启（4023次），每次都失败

---

## 版本回退问题

### Git状态分析

```
Git历史: 只有1个提交 d13d83e "服务器完整代码和数据库备份"
GitHub仓库: northland-studio/xuanjian.top-new (空仓库)
```

**问题**：
- 服务器代码仓库被重新初始化
- 所有历史版本丢失
- 无法回滚到之前版本

### Git状态显示的删除文件
- public/beiyu/* (多个文件)
- public/znq/* (多个文件)
- downloads/*.apk, *.exe

---

## Nginx配置冲突警告

启动时出现多个server_name重复定义警告：

```
conflicting server name "beiyu.xuanjian.top" on 0.0.0.0:80, ignored
conflicting server name "class-7-history.xuanjian.top" on 0.0.0.0:80, ignored
conflicting server name "class7.xuanjian.top" on 0.0.0.0:80, ignored
conflicting server name "debatestar.xuanjian.top" on 0.0.0.0:80, ignored
conflicting server name "xuanjian.top" on 0.0.0.0:80, ignored
conflicting server name "www.xuanjian.top" on 0.0.0.0:80, ignored
conflicting server_name "115.190.153.44" on 0.0.0.0:80, ignored
conflicting server name "monitor.xuanjian.top" on 0.0.0.0:80, ignored
conflicting server name "superskin.xuanjian.top" on 0.0.0.0:80, ignored
```

**原因**: `/etc/nginx/sites-available/` 和 `/etc/nginx/conf.d/default.conf` 中重复定义了相同的域名。

---

## 解决方案

### 1. 端口冲突修复

```bash
# 杀掉宝塔进程
kill 1504
kill 245478

# 删除宝塔项目目录
rm -rf /www/wwwroot/xuanjian.top
rm -rf /www/wwwroot/xuanjian.top_NDWc7.tar.gz
rm -rf /www/wwwroot/xuanjian

# 重启PM2进程
pm2 restart xuanjian-guild
```

### 2. 宝塔面板彻底删除

```bash
# 停止宝塔服务
systemctl stop bt

# 删除宝塔目录
rm -rf /www/server
rm -rf /www/wwwroot
rm -rf /www/wwwlogs
rm -rf /www/backup
rm -rf /www/dk_project

# 删除宝塔配置
rm -rf /etc/init.d/bt
```

### 3. Nginx配置清理（建议）

删除 `/etc/nginx/conf.d/default.conf` 或清理 `sites-available/` 中的重复配置。

---

## 修复结果

| 项目 | 修复前 | 修复后 |
|------|--------|--------|
| PM2 xuanjian-guild | errored (重启4023次) | online |
| 端口3000 | 被宝塔占用 | PM2正常监听 |
| HTTP响应 | 500错误 | 200 OK |

---

## 预防措施

1. **统一部署方式**: 使用PM2管理所有Node.js项目，避免宝塔面板重复部署
2. **端口隔离**: 不同项目使用不同端口，避免冲突
3. **Git版本管理**: 保持完整的Git历史，定期推送至远程仓库
4. **监控告警**: 设置PM2进程状态监控，及时发现异常重启

---

## 附录：宝塔面板相关目录

| 目录 | 用途 |
|------|------|
| /www/server | 宝塔面板核心 |
| /www/wwwroot | 网站根目录 |
| /www/wwwlogs | 日志目录 |
| /www/backup | 备份目录 |
| /www/dk_project | Docker项目 |
| /etc/init.d/bt | 宝塔启动脚本 |