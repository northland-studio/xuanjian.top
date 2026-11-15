# 玄剑 Wiki 审计（exam.xuanjian.top）

最小化独立服务：直连官网 `guild.db` 只读展示 wiki 全量信息，本地 `exam.db` 存审计状态与每日任务。

## 功能

- **OAuth 登录**：`wiki-exam` 客户端向 `xuanjian.top` 走授权码模式；httpOnly 签名会话
- **仅 LV1+**：登录后校验 `level >= 1`，LV0 显示无权限页
- **Wiki 全量**：列表（标题/分类/状态/作者/更新时间/字数/审计状态，含草稿/待审/归档）+ 正文 + 版本历史
- **每日任务**：每天首次访问自动分配 10 条「未审计」页面；任务当天固定
- **一页一审**：每个页面只允许审计一次（`audits.page_id UNIQUE`），审计后不再分配
- **审计数量不限**：可随时审计任意未审计页面（不受 10 条限制）
- **审计记录**：结果（通过/有问题）+ 备注 + 审计人 + 时间 + 页面快照时间；「我的 / 全站」视图

## 环境变量（`.env`）

```
PORT=3903
SITE_URL=https://exam.xuanjian.top
GUILD_DB=/var/www/xuanjian-guild/data/guild.db
EXAM_DB=/var/www/xuanjian-exam/data/exam.db
OAUTH_PROVIDER=https://xuanjian.top
OAUTH_CLIENT_ID=wiki-exam
OAUTH_CLIENT_SECRET=<在 y.xuanjian.top OAuth 客户端表登记时的 secret>
OAUTH_REDIRECT_URI=https://exam.xuanjian.top/callback/oauth
SESSION_SECRET=<随机 64 hex>
DAILY_TASK_COUNT=10
```

## 部署

```bash
# 目录
mkdir -p /var/www/xuanjian-exam
# 上传 server.js public/ package.json .env
# 依赖复用官网 node_modules（express + sqlite3）
NODE_PATH=/var/www/xuanjian-guild/node_modules pm2 start server.js --name exam --update-env
# nginx: exam.xuanjian.top -> 127.0.0.1:3903（Cloudflare 代理，监听 80）
```

## OAuth 客户端登记

在 `xuanjian.top` 的 `oauth_clients` 表登记：
- `client_id = wiki-exam`
- `client_secret_hash = sha256(client_secret)`
- `redirect_uris = ["https://exam.xuanjian.top/callback/oauth"]`
- `allowed_scopes = ["read:user","read:member"]`
- `is_confidential = 1`
