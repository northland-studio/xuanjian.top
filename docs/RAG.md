# 玄剑姬 RAG 问答系统

面向公会 Wiki 的检索增强问答：官网浮窗与 QQ 群机器人共用同一套核心服务，只依据**已发布** Wiki 内容回答，并给出可点击来源。

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

## 九、测试

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

## 十、故障与回滚

- 模型不可用/欠费：问答返回 503 与明确文案，日志记录 `status=error` 与 `error_type`；`deepseek-flash` 是推理模型，已默认 `thinking=disabled` 避免空回复。
- 预算熔断：连续失败达到阈值后熔断，冷却期自动恢复；预算超限直接拒绝并提示。
- 索引失败：任务按 30/60/120s 退避重试，4 次后置 `failed`，可在 Admin 重试。
- 回滚：RAG 只新增表与文件，回滚只需 `git revert` 相关提交并 `pm2 restart`；如需彻底清理，删除 `rag_*` 表即可（不影响 Wiki 原有功能）。
