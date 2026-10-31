# OAuth 2.0 接入指南

> 玄剑公会统一登录 · 版本 v2（2026-10-31）
> 站点：https://xuanjian.top ｜ 授权服务：`/api/oauth/*` ｜ 资源鉴权：`/api/cdn/*`

本文档面向两类接入方：

- **机密客户端**（有服务端的项目，如 Nork、Northbooker）：持有 `client_secret`
- **公共客户端**（桌面/移动客户端，如 PCL2 定制启动器）：无 `client_secret`，**强制 PKCE**

---

## 一、能力概览

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/oauth/authorize` | GET | 授权页（浏览器打开），未登录会引导到官网登录 |
| `/api/oauth/authorize` | POST | 用户同意后签发授权码（请求带用户令牌） |
| `/api/oauth/token` | POST | 授权码换令牌 / 刷新令牌 |
| `/api/oauth/revoke` | POST | 吊销 refresh_token |
| `/api/oauth/verify` | GET | 校验 access_token（兼容旧接入方） |
| `/api/oauth/userinfo` | GET | 用户资料（按 scope 过滤） |
| `/api/oauth/member` | GET | 成员身份与游戏 ID 绑定情况 |
| `/api/oauth/scopes` | GET | 可用权限列表 |
| `/api/cdn/manifest` | GET | CDN 文件清单（需会员 + `cdn:read`） |
| `/api/cdn/sign` | POST | 批量签名下载地址（需会员 + `cdn:read`） |
| `/api/cdn/sign` | GET | 单文件签名（需会员 + `cdn:read`） |
| `/api/cdn/info` | GET | CDN 域名与限额 |

### 权限范围（scope）

| scope | 说明 |
|---|---|
| `read:user` | 昵称、头像、等级、称号、贡献点 |
| `read:member` | 是否公会成员、绑定的游戏 ID |
| `cdn:read` | 获取 CDN 资源临时下载凭证 |

### 令牌参数

| 项 | 值 |
|---|---|
| access_token | JWT，**2 小时**（可用 `OAUTH_ACCESS_TTL` 调整） |
| refresh_token | 随机串，**30 天**，一次性轮换 |
| 授权码有效期 | **5 分钟**，一次性使用 |
| 刷新令牌轮换 | 每次刷新后旧令牌立即失效（防重放） |

---

## 二、机密客户端接入（有服务端）

以 Nork 为例，技术栈 Node.js。三个步骤：

### 1) 注册应用（管理员操作）

管理员在后台调用：

```bash
POST /api/oauth/clients
Authorization: Bearer <管理员令牌>
Content-Type: application/json

{
  "client_id": "nork",
  "name": "Nork",
  "description": "Nork 问答与答题平台（公会成员登录）",
  "is_confidential": true,
  "redirect_uris": ["https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback"],
  "allowed_scopes": ["read:user", "read:member"],
  "owner_contact": "northland@xuanjian.top",
  "homepage": "https://nork.xuanjian.top"
}
```

响应中的 `client_secret` **只返回一次**，请立即写入应用 `.env`：

```env
XUANJIAN_CLIENT_ID=nork
XUANJIAN_CLIENT_SECRET=<仅此一次可见>
XUANJIAN_REDIRECT_URI=https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback
XUANJIAN_PROVIDER_URL=https://www.xuanjian.top
```

> 密钥轮换：`POST /api/oauth/clients/:id/rotate-secret`（旧密钥立即失效）
> 应用停用：`DELETE /api/oauth/clients/:id`（现有令牌仍有效至过期）

### 2) 发起授权

```js
const params = new URLSearchParams({
  client_id: 'nork',
  redirect_uri: 'https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback',
  response_type: 'code',
  state: crypto.randomBytes(16).toString('hex'),
  scope: 'read:user read:member'
});
res.redirect('https://www.xuanjian.top/api/oauth/authorize?' + params);
```

**state 必须校验**（存 cookie 或 session，回调时比对），防 CSRF。

### 3) 回调换令牌 + 校验用户

```js
// 1. code 换 token（机密客户端必须带 client_secret）
const tr = await fetch('https://www.xuanjian.top/api/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    code: req.query.code,
    client_id: 'nork',
    client_secret: process.env.XUANJIAN_CLIENT_SECRET,
    redirect_uri: process.env.XUANJIAN_REDIRECT_URI
  })
});
const { access_token, refresh_token, expires_in, scope } = await tr.json();

// 2. 取用户信息（含 is_member）
const vr = await fetch('https://www.xuanjian.top/api/oauth/verify', {
  headers: { Authorization: 'Bearer ' + access_token }
});
const { valid, user } = await vr.json();
if (!valid) return res.redirect('/?auth_error=verify_failed');
// user = { id, username, nickname, avatar, level, title, contribution, is_member, game_id }
```

### 4) 刷新令牌

access_token 2 小时过期，用 refresh_token 换新的（旧 refresh 立即失效）：

```js
const r = await fetch('https://www.xuanjian.top/api/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'refresh_token',
    refresh_token,
    client_id: 'nork',
    client_secret: process.env.XUANJIAN_CLIENT_SECRET
  })
});
```

---

## 三、公共客户端接入（PCL2 定制启动器）

公共客户端（桌面程序）**不能保存 client_secret**（会被逆向），因此：

- 强制使用 **PKCE（S256）**
- 回调使用自定义协议 `pcl2://oauth/callback` 或本机回环 `http://127.0.0.1:17666/oauth/callback`
- 获得的 access_token 放在内存/系统凭据管理器，**不要明文写配置文件**

### 完整流程

```
启动器                          系统浏览器                      玄剑官网
   |                               |                              |
   | 1. 生成 verifier/challenge    |                              |
   | 2. 打开浏览器 ───────────────> |                              |
   |   /api/oauth/authorize?       | 3. 用户登录（如需）+ 点同意 ─> |
   |     client_id=pcl2-launcher   |                              | 4. 签发授权码
   |     code_challenge=<S256>     | <── 5. 回调 pcl2://oauth/callback?code=xxx
   |                               |                              |
   | 6. 启动器捕获 code，POST /api/oauth/token（code + verifier）
   | 7. 得到 access_token / refresh_token
   | 8. GET /api/oauth/member 判断是否公会成员
   | 9. POST /api/cdn/sign 换取下载地址
```

### 示例代码（Node/Electron；其它语言同理）

```js
const crypto = require('crypto');

// 1) 生成 PKCE
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

// 2) 打开浏览器
const params = new URLSearchParams({
  client_id: 'pcl2-launcher',
  redirect_uri: 'pcl2://oauth/callback',
  response_type: 'code',
  scope: 'read:user read:member cdn:read',
  state: crypto.randomBytes(16).toString('hex'),
  code_challenge: challenge,
  code_challenge_method: 'S256'
});
shell.openExternal('https://www.xuanjian.top/api/oauth/authorize?' + params);

// 3) 自定义协议回调拿到 code 后
const tr = await fetch('https://www.xuanjian.top/api/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    code,
    client_id: 'pcl2-launcher',
    redirect_uri: 'pcl2://oauth/callback',
    code_verifier: verifier          // 注意：公共客户端用 verifier，不是 secret
  })
});
const { access_token, refresh_token } = await tr.json();

// 4) 验证会员
const m = await (await fetch('https://www.xuanjian.top/api/oauth/member', {
  headers: { Authorization: 'Bearer ' + access_token }
})).json();
// { ok: true, is_member: true, game_id: "xxx", level: 1, ... }

// 5) 取下载地址
const { urls } = await (await fetch('https://www.xuanjian.top/api/cdn/sign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + access_token },
  body: JSON.stringify({ keys: ['launcher/versions/1.0.0/client.jar'], ttl: 1800 })
})).json();
```

### `pcl2://` 协议注册（Windows 安装包）

安装包需要注册自定义协议，否则浏览器回调打不到启动器：

```reg
Windows Registry Editor Version 5.00

[HKEY_CLASSES_ROOT\pcl2]
@="URL:PCL2 Protocol"
"URL Protocol"=""

[HKEY_CLASSES_ROOT\pcl2\shell\open\command]
@="\"C:\\Path\\To\\PCL2.exe\" \"%1\""
```

> 也可以不用自定义协议：让启动器本地起一个 HTTP 监听（`http://127.0.0.1:17666/oauth/callback`），
> 该地址已在应用白名单中登记。**端口需固定**，否则会被回调白名单拒绝。

---

## 四、错误码

| HTTP | error | 含义 / 处理 |
|---|---|---|
| 400 | `invalid_request` | 参数缺失或不合法 |
| 400 | `invalid_grant` | 授权码/刷新令牌无效、过期、已使用，或 PKCE 校验失败 |
| 400 | `unsupported_grant_type` | 只支持 `authorization_code` 与 `refresh_token` |
| 401 | `invalid_client` | 应用不存在、已停用、或 client_secret 不正确 |
| 401 | `missing_token` / `invalid_token` | 未携带或携带了无效 access_token |
| 403 | `insufficient_scope` | 令牌缺少所需 scope（如 CDN 需要 `cdn:read`） |
| 403 | `not_member` | 令牌有效但不是公会成员（未绑定游戏 ID / 已冻结） |
| 403 | `access_denied` | 用户点了「拒绝」，或账号被冻结 |
| 503 | `server_error` + CDN 未配置 | 服务端七牛密钥缺失 |

`/api/oauth/member` 返回的 `reason` 字段说明非会员原因：`frozen`（冻结）、`no_game_id`（未绑定游戏 ID）、`not_member`。

---

## 五、安全约定

1. **redirect_uri 严格全等匹配**白名单，不做前缀/通配，防止开放重定向
2. **公共客户端必须 PKCE**，机密客户端可选
3. 授权码一次性（复用会连带吊销该用户该应用的刷新令牌）
4. 刷新令牌一次性轮换；被吊销后立即失效
5. 所有授权、令牌签发、复用攻击、CDN 拒绝都会写 `oauth_audit_logs`
6. `client_secret` 只存 SHA-256 哈希，明文仅在创建/轮换时返回一次
7. **不要把 client_secret 或 access_token 提交到 Git**；`.env` 权限 600

---

## 六、CDN 资源鉴权方案（防七牛资源滥用）

### 6.1 为什么不能直接把 CDN 地址给启动器

公开的 CDN 域名 + 公开 bucket = 任何人拿到链接就能下，也可以盗链刷流量。
方案：**七牛私有空间 + 服务端短时效签名**，签名需要会员身份才能换。

### 6.2 七牛侧配置（一次性，控制台操作）

1. **新建私有空间**：对象存储 → 新建 Bucket
   - 名称：`xuanjian-launcher`
   - 存储区域：**华东（as0）**（与现有 `xuanjian-top` 一致）
   - 访问控制：**私有**
2. **绑定 CDN 域名**：CDN → 域名管理 → 绑定域名
   - 域名：`cdn-launcher.xuanjian.top`
   - 源站：`xuanjian-launcher`
   - 缓存：静态文件长缓存（如 `launcher/` 前缀 7 天）
   - HTTPS：上传/复用证书
3. **创建密钥**：个人中心 → 密钥管理（沿用现有 `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY` 即可，无需新建）
4. **开启 referer 防盗链**（可选但推荐）：CDN 配置 → 访问控制 → Referer 防盗链设为白名单，允许 `xuanjian.top` 与空 referer（启动器请求无 referer）
5. **时间戳防盗链**（可选）：七牛也支持 URL 时间戳签名，但本方案用 `privateDownloadUrl`（更简单，无需额外配置）

### 6.3 官网服务端配置

编辑 `/var/www/xuanjian-guild/.env`：

```env
# 已有
QINIU_ACCESS_KEY=xxx
QINIU_SECRET_KEY=xxx

# 新增（CDN 专用，可与会话区分）
CDN_BUCKET=xuanjian-launcher
CDN_DOMAIN=https://cdn-launcher.xuanjian.top
CDN_SIGN_TTL=1800          # 签名有效期（秒），最大 3600
```

重启：`pm2 restart xuanjian-guild --update-env`

> 若暂时不想新建 bucket，可先沿用 `QINIU_BUCKET` / `QINIU_DOMAIN`，
> 把启动器文件放在 `launcher/` 前缀下——但**旧 bucket 是公开读的，起不到防滥用作用**，
> 建议还是新建私有空间。

### 6.4 上传启动器文件

控制台或 CLI 上传到 `launcher/` 前缀：

```
launcher/
├── versions/
│   ├── 1.0.0/
│   │   ├── client.jar
│   │   ├── libraries.zip
│   │   └── assets.zip
│   └── 1.0.1/...
└── manifest.json
```

服务端只做签名，不做转存，上传走七牛控制台/CLI 即可。

### 6.5 客户端获取流程

```http
# 1. 清单（顺便做版本更新检查）
GET /api/cdn/manifest?prefix=launcher/versions/
Authorization: Bearer <access_token>

# 响应
{
  "ok": true,
  "prefix": "launcher/versions/",
  "count": 12,
  "items": [
    { "key": "launcher/versions/1.0.1/client.jar", "size": 1234567, "hash": "Fxxx", "mtime": 17930000000000000 }
  ],
  "cdn": { "domain": "https://cdn-launcher.xuanjian.top", "bucket": "xuanjian-launcher" },
  "signTtl": 1800
}
```

```http
# 2. 批量签名（一次最多 200 个）
POST /api/cdn/sign
Authorization: Bearer <access_token>
Content-Type: application/json

{ "keys": ["launcher/versions/1.0.1/client.jar"], "ttl": 1800 }

# 响应
{
  "ok": true,
  "expires_at": 1793001800,
  "expires_in": 1800,
  "urls": {
    "launcher/versions/1.0.1/client.jar": "https://cdn-launcher.xuanjian.top/launcher/versions/1.0.1/client.jar?e=1793001800&token=xxx"
  }
}
```

签名 URL 在有效期内可直接 HTTP 下载，**不要缓存或外传**。

### 6.6 额度与限制

| 项 | 值 |
|---|---|
| 签名有效期 | 默认 1800 秒，最大 3600 秒 |
| 单次批量签名 | 最多 200 个 key |
| 清单单页 | 默认 500 条，最大 1000 条 |
| 权限要求 | 令牌含 `cdn:read` **且** 是公会成员 |

### 6.7 反滥用效果

| 攻击方式 | 结果 |
|---|---|
| 直接分享 CDN 链接 | 链接带签名，过期即失效（≤1 小时） |
| 站外用户登录后下载 | 不是会员 → `/api/cdn/*` 返回 403 `not_member` |
| 盗用 access_token | 2 小时过期；可用 `/api/oauth/revoke` 吊销刷新令牌 |
| 批量爬取 | 单次 200 个 key 限制 + 审计日志可追溯 |
| 盗链 | 私有空间必须签名，无签名请求七牛直接拒绝 |

---

## 七、运维

### 查看已注册应用

```bash
sqlite3 /var/www/xuanjian-guild/data/guild.db \
  "SELECT client_id, name, is_confidential, is_active, redirect_uris, allowed_scopes FROM oauth_clients;"
```

### 查看接入审计

```bash
sqlite3 /var/www/xuanjian-guild/data/guild.db \
  "SELECT created_at, event, client_id, user_id, ip FROM oauth_audit_logs ORDER BY id DESC LIMIT 20;"
```

### 接口管理应用

```bash
# 列表（管理员令牌）
curl -H "Authorization: Bearer $ADMIN" https://xuanjian.top/api/oauth/clients

# 轮换密钥
curl -X POST -H "Authorization: Bearer $ADMIN" https://xuanjian.top/api/oauth/clients/1/rotate-secret

# 停用
curl -X DELETE -H "Authorization: Bearer $ADMIN" https://xuanjian.top/api/oauth/clients/1
```

### 批量注册（脚本）

```bash
node scripts/register-oauth-clients.js clients.json    # 幂等：已存在则更新配置
```

### 定时清理

服务端每 6 小时自动清理：过期授权码、过期刷新令牌、90 天前审计日志。

---

## 八、当前已注册应用

| client_id | 名称 | 类型 | 回调地址 | 权限 |
|---|---|---|---|---|
| `nork` | Nork | 机密 | `https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback` | `read:user` `read:member` |
| `northbooker` | Northbooker | 机密 | `https://northbooker.xuanjian.top/api/auth/callback` | `read:user` `read:member` |
| `pcl2-launcher` | 玄剑启动器（PCL2 定制版） | 公共（PKCE） | `pcl2://oauth/callback`、`http://127.0.0.1:17666/oauth/callback` | `read:user` `read:member` `cdn:read` |

> 新增应用请走 `POST /api/oauth/clients`，不要直接改数据库。
> 密钥仅在创建/轮换时返回一次，丢失只能重新轮换。

---

## 九、测试

```bash
# 生产端到端测试（需要管理员令牌）
cd /var/www/xuanjian-guild
node scripts/oauth-e2e.js "<管理员JWT>"
```

覆盖 25 项：PKCE 完整流程、错误 verifier、授权码复用、scope 越权、
redirect_uri 白名单、未注册 client、机密客户端密钥校验、令牌刷新与轮换、
`/verify` `/userinfo` `/member` 兼容性、CDN 鉴权与签名。

---

## 十、变更记录

| 日期 | 内容 |
|---|---|
| 2026-10-31 | OAuth v2：应用注册表、client_secret 校验、PKCE、redirect 白名单、授权码入库、refresh 轮换、审计日志、CDN 鉴权接口；接入 Nork、Northbooker、PCL2 启动器 |
