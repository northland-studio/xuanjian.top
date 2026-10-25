# 玄剑姬 RAG 问答系统

面向公会 Wiki 的检索增强问答：官网浮窗与 QQ 群机器人共用同一套核心服务，只依据**已发布** Wiki 内容回答，并给出可点击来源。

## 零、角色设定（人设）

玄剑姬是**藏剑阁化形的剑娘**：原本是公会藏剑阁里的一柄青锋剑，吸收公会的讨论与章程之气化形为少女；她把写进 Wiki 的事当作自己的「剑谱」。

- 性格：古灵精怪、俏皮可爱、爱逞一点口舌之快，但正事非常靠谱
- 口味：最爱糖醋排骨，可以拿它打比方（只在语气层面，绝不代替事实）
- 说话：自称「本剑」或「我」，不用 emoji，先给答案再给依据，结尾可加一句不超过 20 字的个人化点评
- 边界：俏皮不越界——不编造同人剧情、不给公会加设定、不冒充管理组；人设**绝不凌驾**于事实与引用规则（见第八节硬性规则）

提示词实现在 `lib/rag/ask.js → buildSystemPrompt()`，版本号 `rag-prompt-v3`，可在 Admin 测试台与问答日志中看到当前版本。

## 一、总体架构

```text
wiki_pages(status=published)
   └─ HTML 清洗 / 按标题路径分块（lib/rag/chunker.js，版本 v1）
        ├─ 硅基流动 BAAI/bge-m3 Embedding（1024 维）→ sqlite-vec（rag_chunks_vec）
        └─ FTS5 trigram 分块全文索引（rag_chunks_fts）
用户问题
   └─ lib/rag/ask.js（唯一 RAG 核心）
        ├─ 向量 Top-K（rag.vectorTopK，默认 50）
        ├─ 全文 Top-K（rag.ftsTopK，默认 50）
        ├─ RRF 融合（k=60）
        ├─ 可检索性过滤：status=indexed 且 indexed_hash=content_hash 且分块版本/模型/维度一致 且 wiki_pages.status=published
        ├─ 证据组装（3~5 块，受 maxContextChars 限制）
        └─ DeepSeek deepseek-flash（默认 thinking=disabled）→ 带 [n] 引用的回答
             ├─ 官网浮窗 POST /api/faq/ask
             └─ QQ 机器人 POST /api/qqbot/rag/ask（X-Bot-Token）
```

## 二、数据模型

`node scripts/migrate-rag.js` 幂等创建（不改动任何现有表）：

| 表/索引 | 用途 |
| --- | --- |
| `rag_page_index` | 页面级索引状态：content_hash / indexed_hash / chunk_count / status(indexed,pending,stale,failed,not_public) / 模型 / 维度 / 分块版本 |
| `rag_chunks` | 分块正文：page_id、ordinal、heading_path、text、text_hash、char_len、index_version |
| `rag_chunks_vec` | sqlite-vec `vec0(chunk_id, embedding float[1024])` |
| `rag_chunks_fts` | FTS5 trigram 分块全文索引（不改动现有 `wiki_search`） |
| `rag_index_tasks` | 持久化索引任务队列（pending/running/success/failed/superseded，含 attempts、next_retry_at） |
| `rag_conversations` / `rag_messages` | 短期会话（按来源+主体+群隔离，空闲 30 分钟过期） |
| `rag_qa_logs` | 问答日志（保留 30 天，自动清理） |
| `rag_feedback` | 有用/无用反馈（同一 request+主体幂等） |
| `rag_audit_logs` | 管理操作审计（不含密钥明文） |
| `rag_usage_daily` | 每日用量与费用估算 |
| `rag_meta` | 索引版本、vec/fts 可用性等元信息 |

## 三、SQLite 扩展与兼容性

- 依赖 `sqlite-vec` npm 包（按平台安装 `sqlite-vec-windows-x64` / `-linux-x64` 等，提供 `vec0.dll/.so`）。
- 启动时由 `lib/rag/runtime.js` 调用 `db.loadExtension()` 加载；失败只降级并记录到 `rag_meta`，不会阻塞网站启动。
- 已实测环境：Node 24 / sqlite3 5.1.6 / SQLite 3.44.2 / sqlite-vec v0.1.9，建表、写入、KNN、删除均通过。
- 降级语义：向量不可用时 Admin 概览显示「不可用」，默认**不允许**仅用 FTS 回答（`rag.allowFtsOnlyFallback=false`）。

## 四、密钥与配置

### 环境变量（官网 .env）

```bash
# 加密主密钥（必填，>=32 字符；缺失时后台无法保存 API Key）
RAG_SECRET_KEY=请生成足够长的随机字符串

# 也可用环境变量直接提供模型 Key（后台未配置时生效）
RAG_EMBEDDING_KEY=
RAG_LLM_KEY=

# 可选：关闭后台索引 worker（测试/脚本环境）
RAG_DISABLE_WORKER=0
```

### 后台配置项（settings 表，键前缀 `rag.`）

`embedding.provider|baseUrl|model|dimension|batchSize|maxCharsPerBatch`、`llm.provider|baseUrl|model|disableThinking`、
`rag.chunkSize|chunkOverlap|vectorTopK|ftsTopK|rrfK|finalChunkCount|maxContextChars|maxOutputTokens`、
`rag.conversationIdleTimeout|conversationMaxTurns|logRetentionDays`、
`rag.guestPerMinute|guestPerDay|userPerMinute|userPerDay|botPerMinute|botPerDay|maxQuestionLength|maxConcurrent`、
`rag.dailyBudget|costAlertThreshold|circuitBreaker|circuitFailThreshold|circuitCooldownSeconds`、`rag.promptVersion`。

- API Key 用 **AES-256-GCM** 加密后存 `settings`，接口只返回脱敏状态（前 4 + 后 4）。
- 留空提交表示不修改；脱敏串（含 `****`）不会被写回；清空密钥需显式调用 clear 接口。
- 普通管理员（level≥1）可看状态、跑连通性与问答测试；超管（level≥2）才能改密钥/模型/提示词/预算。

## 五、索引运维

```bash
# 首次部署：建表
node scripts/migrate-rag.js

# 启动网站后：后台 worker 每 5 秒处理最多 3 个任务；也可在 Admin 手动触发
# Admin → 玄剑姬 AI → 索引管理 → 「立即处理任务」
```

- 任何 Wiki 变更（新建/编辑/发布/归档/恢复历史/删除/分类调整）都会在业务层（`lib/wiki.js`）触发 `indexer.onPageChanged()`：
  已发布 → 立即置 `stale` 并投递索引任务；非公开 → 立即 `not_public` 并清空分块。
- **内容改了但索引没更新时，旧分块不会被检索到**（过滤在 SQL 层，不靠输出阶段兜底）。
- 全量重建：Admin → 索引管理 → 「全量重建」（仅超管，二次确认，同一时间只允许一个）。
- 一致性核对：Admin「一致性核对」或每 6 小时自动执行，修复遗漏页面、不可公开残留、孤立分块。
- 更换 Embedding 模型/维度后必须全量重建，Admin 会提示 `needRebuild`。

## 六、问答测试台

Admin → 玄剑姬 AI → 问答测试台：输入真实问题后会返回
回答、引用编号映射的真实来源、向量候选与排名、FTS 候选与排名、RRF 融合结果、最终传给 LLM 的分块、耗时与用量、
索引版本/模型/提示词版本。诊断信息**只在管理端**返回。

## 七、来源引用错误排查

1. 看日志 `rag_qa_logs.diagnostics`（精简版）与 Admin 测试台完整诊断。
2. 引用序号越界：服务端会纠正重试一次，仍失败则剥离非法编号并标记 `citationCorrected`。
3. 来源页面不可见：`mapSources()` 会重新校验 `wiki_pages.status='published'`，非公开页面不会出现在 `sources`。
4. 大量「Wiki 暂无可靠记载」：检查该页 `rag_page_index.status` 是否为 `indexed`，以及 `indexed_hash` 是否等于 `content_hash`。

## 八、群白名单配置（QQ 机器人）

```bash
# 机器人 .env
RAG_ENABLED=on
RAG_ALLOWED_GROUPS=860336849,123456789   # 空 = 群内问答禁用（不会放行全部）
RAG_PRIVATE=off                          # 私聊问答默认关闭
```

注意：`isAllowedGroup()`（原有）在空表时放行全部，**不能**用于 RAG；RAG 使用独立的 `isRagAllowedGroup()`，空表即拒绝。

## 九、官网浮窗（抽屉模式）

- **悬浮按钮**：固定在屏幕**右缘垂直居中**（右下角会挡住皮肤预览器），半圆贴边，含圆形头像与竖排「玄剑姬」字样
- **抽屉**：点击后从右侧滑出，宽 408px（≤640px 时全宽）；半透明遮罩点击关闭，`Esc` 也可关闭；打开时按钮淡出
- **头像**：`https://cdn.xuanjian.top/xjj.png`（头部 40px、消息 28px、按钮 34px，圆形裁切）
- **Markdown**：`RagMarkdown.jsx` 为**零依赖**轻量渲染器，以 React 元素输出（不使用 `innerHTML`，天然防 XSS），支持标题、有序/无序列表、粗体、斜体、行内代码、代码块、引用、链接、分隔线；刻意不支持 HTML 与表格
- **主题**：所有颜色/圆角/阴影统一使用站点令牌（`--card`/`--bg`/`--text`/`--text-secondary`/`--border`/`--primary`/`--input-bg`/`--radius-lg`/`--shadow-lg`），自动跟随 `html[data-theme="dark"]`
- **交互**：`api.post('/api/faq/ask')`，会话 ID 存 `localStorage`（键 `xuanjian_rag_conv`）；「新会话」清空本地上下文并让服务端新开

## 十、测试

```bash
# 分块器自检（19 项）
node scripts/rag/verify-chunker.js

# sqlite-vec 真实加载/写入/KNN
node scripts/rag/verify-sqlite-vec.js

# 模型连通性（需要有效 Key 与余额）
node scripts/rag/verify-models.js

# 端到端（临时库；真实调用两家模型；Embedding 不可用时自动降级并标注）
RAG_EMBEDDING_KEY=... RAG_LLM_KEY=... node scripts/rag/test-rag.js
```

## 十一、故障与回滚

- 模型不可用/欠费：问答返回 503 与明确文案，日志记录 `status=error` 与 `error_type`；`deepseek-flash` 是推理模型，已默认 `thinking=disabled` 避免空回复。
- 预算熔断：连续失败达到阈值后熔断，冷却期自动恢复；预算超限直接拒绝并提示。
- 索引失败：任务按 30/60/120s 退避重试，4 次后置 `failed`，可在 Admin 重试。
- 回滚：RAG 只新增表与文件，回滚只需 `git revert` 相关提交并 `pm2 restart`；如需彻底清理，删除 `rag_*` 表即可（不影响 Wiki 原有功能）。

## 十二、当前部署现状

> 记录截至本文档更新时的真实部署状态，便于交接与排障。

### 官网（https://xuanjian.top）

| 项 | 值 |
| --- | --- |
| 服务器 | HK `64.90.13.2`，应用目录 `/var/www/xuanjian-guild` |
| 进程管理 | pm2 `xuanjian-guild`（`node server.js`） |
| 反代 | nginx 站点 `xuanjian-guild`，HTTPS（Let's Encrypt） |
| 数据库 | `/var/www/xuanjian-guild/data/guild.db`（SQLite WAL） |
| RAG 运行时 | 随 `server.js` 启动：加载 sqlite-vec、启动索引 worker、每小时清理过期会话/日志、每 6 小时一致性核对 |
| 当前索引 | 334 篇已发布页面全部 `indexed`，约 1669 分块 / 1669 向量，模型 `BAAI/bge-m3`，分块版本 `v1` |
| 提示词版本 | `rag-prompt-v3`（人设：藏剑阁剑娘） |
| 密钥 | `RAG_SECRET_KEY` 已生成并写入 `.env`（600）；Embedding/LLM Key 走环境变量或后台加密存储 |

### QQ 机器人（群机器人）

| 项 | 值 |
| --- | --- |
| 服务器 | `43.248.3.161:20043`（root，密钥 `id_napcat` 只在 HK 上） |
| 应用目录 | `/var/www/xuanjian-group-bot`（**不是 git 仓库**，采用打包覆盖部署） |
| 进程管理 | systemd `xuanjian-group-bot.service`（`node dist/index.js`） |
| OneBot | NapCat 监听 `127.0.0.1:3001`，机器人以 WS 客户端接入 |
| 官网对接 | `OFFICIAL_API_BASE=https://xuanjian.top` + `X-Bot-Token`（`OFFICIAL_BOT_TOKEN`） |
| RAG 开关 | `RAG_ENABLED=on`、`RAG_ALLOWED_GROUPS=860336849`、`RAG_PRIVATE=off` |

### 已上线内容

- 官网右缘抽屉式玄剑姬浮窗（Markdown 渲染、来源链接、会话追问、明暗色适配）
- `/admin → 玄剑姬 AI` 五个子页：概览与健康 / 模型配置 / 索引管理 / 问答测试台 / 用量与日志
- QQ 群 `#玄剑姬`、`#问答`、`#rag`、`#ask` 指令与群内 @ 机器人提问
- Wiki「网站教程」已收录《Wiki 编写指南：从零写一篇能用的词条》（id 353）

## 十三、管理面板说明（/admin → 玄剑姬 AI）

### 子页功能

| 子页 | 内容 |
| --- | --- |
| 概览与健康 | 向量/FTS 可用性、提示词版本、熔断状态、索引规模（已发布/已索引/分块/向量/任务）、今日用量与预算、密钥状态、最近失败任务 |
| 模型配置 | 分组设置表单（模型与端点 / 检索与分块 / 会话与日志 / 限流与输入限制 / 预算与熔断）+ 密钥区；脏值追踪、按组/全部恢复默认、Embedding 变更提示重建 |
| 索引管理 | 页面索引列表（状态、分块数、hash 对比、更新时间）、单页重建、任务列表与重试、立即处理任务、一致性核对、全量重建 |
| 问答测试台 | 真实检索 + LLM：回答、真实来源、向量/FTS 候选、RRF 融合结果、参数与耗时；另有「仅检索」接口 `/api/faq/admin/retrieve` |
| 用量与日志 | 每日用量（按来源）、最近问答日志（状态、耗时、tokens、是否真实用量） |

### 权限矩阵

| 能力 | 普通管理员（≥1） | 超级管理员（≥2） |
| --- | --- | --- |
| 查看状态/索引/任务/日志/用量 | 可以 | 可以 |
| 连通性测试、问答测试、单页重建、重试、核对 | 可以 | 可以 |
| 修改模型/端点/提示词/限流/预算 | 只读 | 可以 |
| 配置/更换/清空 API Key | 只读（仅脱敏状态） | 可以 |
| 全量重建 | 不可见 | 可以（二次确认，互斥） |

服务端一律用 `adminMiddleware` / `superAdminMiddleware` 实时读库校验，不依赖前端隐藏按钮。

### 配置项分组（settings 表，键前缀 `rag.`）

- **模型**：`embedding.provider/baseUrl/model/dimension/batchSize/maxCharsPerBatch`、`llm.provider/baseUrl/model/disableThinking`
- **检索**：`chunkSize/chunkOverlap/vectorTopK/ftsTopK/rrfK/finalChunkCount/maxContextChars/maxOutputTokens`
- **会话**：`conversationIdleTimeout/conversationMaxTurns/logRetentionDays`
- **限流**：`guest|user|bot × PerMinute/PerDay`、`maxQuestionLength`、`maxConcurrent`
- **预算**：`dailyBudget/costAlertThreshold/circuitBreaker/circuitFailThreshold/circuitCooldownSeconds/allowFtsOnlyFallback`

保存接口带数值范围校验（如 `chunkSize` 仅 120~2000），越界直接 400，不会把非法值写库。

## 十四、机器人部署与验证

### 为什么不用 git

机器人服务器上 `/var/www/xuanjian-group-bot` 不是 git 仓库（历史上是复制部署），因此不能 `git pull`，采用**打包覆盖**：

```bash
# 本地：打包需要同步的文件
tar -czf bot-src.tar.gz src package.json package-lock.json tsconfig.json README.md .env.example ecosystem.config.cjs

# 上传后远端：备份 -> 覆盖 -> 构建 -> 配置 env -> 重启
bash scripts/rag/deploy-bot-tar.sh    # 参见仓库内脚本（含备份与构建校验）
```

脚本会：备份 `src/dist/.env`（`.bak-时间戳`）→ 解包覆盖 → `npm ci` + `tsc` → 写入 `RAG_*` 环境变量（600）→ `systemctl restart xuanjian-group-bot` → 输出进程与 3001 监听状态。

### 验证清单

```bash
# 1. 服务与进程
systemctl is-active xuanjian-group-bot
ps -eo pid,etime,cmd | grep 'xuanjian-group-bot/dist/index.js' | grep -v grep

# 2. 启动日志
journalctl -u xuanjian-group-bot -n 30 --no-pager | grep -v '\[pay\]'

# 3. 用机器人自己的 Bot-Token 调官网 RAG 接口
TOKEN=$(grep '^OFFICIAL_BOT_TOKEN=' .env | cut -d= -f2-)
curl -s -X POST https://xuanjian.top/api/qqbot/rag/ask \
  -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" \
  --data-binary '{"question":"入会需要什么条件","userId":"10001","groupId":"860336849"}'
# 期望：ok=true；无 ok 之外的诊断字段；无 Token 时返回 401

# 4. 群内实测
#   #玄剑姬 贡献点怎么获得
#   @机器人 保证金什么时候退
```

### 常见问题

- **机器人不回应**：先看 `journalctl` 是否有 NapCat 连接失败；NapCat 侧端口应为 `127.0.0.1:3001`（不是 3000）。
- **群里说「尚未开放」**：说明该群不在 `RAG_ALLOWED_GROUPS` 中。RAG 白名单**空即禁用**（与 `ALLOWED_GROUPS` 的「空表放行全部」语义不同）。
- **回答「服务暂时不可用」**：官网 `/api/faq/ask` 异常或限流；到官网 `pm2 logs xuanjian-guild` 查 `[rag]` 日志。
- **SSH 到机器人服务器偶发超时**：对方 sshd 对短时间高频连接有节流，批量操作时降低频率或改用单连接投递。

## 十五、运维命令速查

```bash
# ---- 官网 ----
cd /var/www/xuanjian-guild
pm2 restart xuanjian-guild --update-env        # 重启（含新 .env）
pm2 logs xuanjian-guild --lines 100            # 日志（含 [rag] 行）
node scripts/migrate-rag.js                    # 幂等迁移/补表
node -e "..."                                  # 需要临时脚本时，写到文件再 node 执行

# 索引状态（在应用目录内执行）
node scripts/rag/prod-stats.js                 # 页面/分块/向量/任务统计与一致性检查
node scripts/rag/prod-rebuild.js               # 后台全量重建（输出进度）

# 冒烟
bash scripts/rag/smoke.sh                      # 站点 + 问答 + 管理鉴权 + 前端产物

# ---- 机器人 ----
systemctl restart xuanjian-group-bot
journalctl -u xuanjian-group-bot -f | grep -v '\[pay\]'
```

## 十六、已知限制与后续可做

| 项 | 现状 | 说明 |
| --- | --- | --- |
| 玄剑姬头像 | 指向 `https://cdn.xuanjian.top/xjj.png`，**当前 404** | 前端已做渐变底兜底，不会破图；上传该图后自动生效，无需改代码 |
| 检索评测 | 24 例（检索命中 18/18、拒答 6/6、引用合法 18/18、草稿泄露 0） | 可扩到 50+ 并加入真实长页面 |
| 重排模型 | 未引入 | 任务书要求先有评测证明必要 |
| 流式输出 | 未实现 | 首版刻意用普通请求，便于网站与机器人共用 |
| 反馈列表页 | 接口 `GET /api/faq/admin/feedback` 已有 | 前端尚未挂页签 |
| 提示词在线编辑 | 未做可视化编辑器 | 目前通过代码内 `buildSystemPrompt()` + `rag.promptVersion` 管理 |
| Embedding 依赖 | 硅基流动账户欠费时返回 402（即使 bge-m3 免费） | 需保证账户无欠费；测试脚本会自动降级并明确标注 |

## 十七、变更记录

| 时间 | 变更 |
| --- | --- |
| 2026-10-24 | 管理面板样式补全（分段页签/卡片/表格/状态徽标），新增 `styles/rag-admin.css` |
| 2026-10-24 | 提示词升级 `rag-prompt-v3`：藏剑阁剑娘人设（古灵精怪、爱吃糖醋排骨），人设不凌驾事实 |
| 2026-10-24 | 官网浮窗改右缘抽屉、Markdown 渲染、头像走 CDN、按钮移到右缘垂直居中 |
| 2026-10-24 | 游客身份由 IP 改为服务端签发匿名 cookie（修复 Cloudflare 下会话无法复用、限流误伤） |
| 2026-10-24 | 机器人端部署完成（systemd `xuanjian-group-bot`，RAG 白名单主群 860336849） |
| 2026-10-24 | 首次全量索引：334 页 / 1669 分块；发布《Wiki 编写指南》并自动入索引 |

## 十八、相关文档

- [WIKI.md](WIKI.md)：Wiki 系统本身（分类、版本、投稿审核）
- [API.md](API.md)：官网 API 总览
- [RENDERING.md](RENDERING.md)：SSG / SSR / SPA 三层渲染
- `/wiki/wiki-bian-xie-zhi-nan-cong-ling-xie-yi-pian-neng-yong-de-ci-tiao`：面向编辑者的《Wiki 编写指南》

## 十九、成本控制（2026-10-25 紧急收紧）

### 问题定位

上线首日出现约 20 元消耗，排查结论：**全部来自 LLM token，不是 Embedding**。

| 指标 | 优化前 |
| --- | --- |
| 累计请求 | 78 次 |
| 累计 token | 112,504（输入 96,749 / 输出 15,755） |
| 单次平均 | 1,607 tokens |
| 单次最高 | 3,341 tokens（输入 2,987） |
| 主要原因 | 上下文过大：5 个证据块 × 600 字 + 6 轮历史 + 较长系统提示；重复问题重复计费；失败请求不记 token 导致看不到真实消耗 |

### 已实施的六项收口

1. **上下文压缩**：`verbose` 证据块 600 → 350 字（`MAX_EVIDENCE_CHARS`），`finalChunkCount` 5 → 2，`maxContextChars` 6000 → 2600，`conversationMaxTurns` 6 → 1
2. **输出上限**：`maxOutputTokens` 700 → 200
3. **候选收敛**：`vectorTopK` / `ftsTopK` 50 → 30（减少无谓 rerank 与上下文）
4. **答案缓存**：同一「来源 + 问题」5 分钟内命中缓存，**0 token**；游客按问题共享（答案只来自 Wiki，无个人数据），登录用户与机器人按主体隔离；缓存命中不占限流配额，并写一条 `status=cached` 日志
5. **每日 token 硬上限**：`rag.dailyTokenLimit`（默认 120,000），超出直接拒答并提示，不再继续花钱
6. **失败也记账**：LLM/检索失败路径记录估算用量（原来记 0，导致账单与库内数据对不上）

顺带修掉一个误导行为：Embedding 抖动导致检索为空时，原来会回答「Wiki 中没有记载」，现在是 **503 服务异常**（并先自动重试一次 Embedding）。

### 优化结果（真实调用实测）

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| 单次 token（平均） | 1,607 | **≈ 860**（实测 830 / 889） |
| 单次输入 token | 1,382 | ≈ 700 |
| 单次输出 token | 225 | ≈ 160 |
| 重复问题 | 全额计费 | **0 token（缓存）** |
| 单日上限 | 无 | 120,000 tokens 硬熔断 |

### 运维提示

- **不要在测试里用生产 Key**：`scripts/rag/eval-rag.js`、`test-rag.js`、`verify-*.js` 会真实调用模型。需要跑逻辑测试时用降级模式或单独的测试 Key：
  ```bash
  RAG_EMBEDDING_KEY=<测试Key> RAG_LLM_KEY=<测试Key> node scripts/rag/test-rag.js
  ```
- 后台「概览与健康」可看今日 token 与上限；「用量与日志」可按来源筛选，`status=cached` 即缓存命中。
- 若仍觉费用偏高，可继续调：`finalChunkCount` 2 → 1、`maxOutputTokens` 200 → 150，或用后台把 `dailyTokenLimit` 调低到 5 万先观察一天。
- 单价核对：请以 DeepSeek 控制台的账单为准；本项目内的费用为**按 token 估算**（`lib/rag/ask.js` 顶部 `PRICE` 常量），不是账单。
