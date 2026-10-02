# Wiki 知识库

> 玄剑公会的长期知识库、制度库、历史档案库、Minecraft 资料库与项目文档中心。
> 与「日报 / 决策 / 贴吧」的区别：Wiki 面向**长期、稳定、结构化、可持续维护**的内容。

- 前台入口：`/wiki`
- 后台入口：`/admin#wiki`
- 代码：`lib/wiki.js`（服务层）、`routes/wiki.js`（接口）、`frontend/src/pages/Wiki*.jsx`（页面）

---

## 1. 路由总览

| 路径 | 说明 |
| --- | --- |
| `/wiki` | 首页：Hero、搜索、分类树、精选、最近更新、热门、最近贡献者 |
| `/wiki/category/:slug` | 分类页：分类介绍、子分类、文章列表（分页）、分类内搜索 |
| `/wiki/:slug` | 文章页：左侧分类树 / 中间正文 / 右侧 TOC + 信息 + 相关文章（移动端单列） |
| `/wiki/:slug/history` | 版本历史：列表、查看、与当前对比（行级 diff）、恢复 |
| `/wiki/search?q=` | 搜索结果页（`Ctrl/⌘ + K` 可在任意 Wiki 页面聚焦搜索框） |
| `/wiki/editor`、`/wiki/editor/:id` | 新建 / 编辑（仅管理员） |

## 2. 数据表

| 表 | 说明 |
| --- | --- |
| `wiki_categories` | 分类，`parent_id` 自引用实现无限级；`sort_order` 控制排序；`slug` 唯一 |
| `wiki_pages` | 页面：`status`(draft/published/archived)、`is_featured`、`is_pinned`、`views`、`cover_image`、`author_id`、`last_editor_id`、预留 `project_id` |
| `wiki_revisions` | 版本：每次正式保存写一条（title/content/summary/editor_id/revision_note） |
| `wiki_page_links` | 内链关系（page_id → target_page_id，唯一约束） |
| `wiki_search` | FTS5 虚拟表：`page_id UNINDEXED, title, summary, content`，`tokenize='trigram'` |

索引：分类 `parent_id/slug`、页面 `category_id/slug/status/updated_at/views`、版本 `page_id+created_at`、内链 `page_id/target_page_id`。

> 为什么用 trigram：中文没有空格，FTS5 默认的 `unicode61` 会把整段中文当成一个 token，搜不到；
> trigram 按 3 字符切片，中文子串可以命中。代价是 <3 字的查询要走 LIKE，代码里已自动分流。

## 3. 接口

全部挂在 `/api/wiki`（生成结果见 `docs/API.md`）。鉴权标记：**登录可选** = 游客可读；**管理员** = `authMiddleware + adminMiddleware`；**超级管理员** = `superAdminMiddleware`。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/wiki` | 登录可选 | 首页聚合数据（精选/最近/热门/贡献者/分类树/总篇数） |
| GET | `/api/wiki/search?q=&category=&page=&limit=` | 登录可选 | 搜索（FTS5 / LIKE 自动分流），空查询返回最近更新 |
| GET | `/api/wiki/categories` | 登录可选 | 分类树 + 扁平列表（管理员加 `?all=1` 可含停用分类） |
| GET | `/api/wiki/categories/:slug` | 登录可选 | 分类详情 + 子分类 + 面包屑 + 文章分页（含子分类） |
| GET | `/api/wiki/:slug` | 登录可选 | 文章详情（含 `content_html` 渲染结果、面包屑、相关、上下篇、`can_edit`） |
| GET | `/api/wiki/:slug/related` | 登录可选 | 相关文章（内链 / 反向链接 / 同分类，最多 10 条） |
| GET | `/api/wiki/:slug/history` | 登录可选 | 版本列表 |
| GET | `/api/wiki/:slug/history/:revisionId` | 登录可选 | 单个版本内容 |
| GET | `/api/wiki/id/:id` | 管理员 | 按 id 取页面（编辑器用） |
| GET | `/api/wiki/slug-suggest?title=&id=` | 管理员 | 标题 → 可用 slug（含重名处理） |
| GET | `/api/wiki/admin/pages` | 管理员 | 后台列表（status/category/author/关键词筛选 + 分页） |
| GET | `/api/wiki/admin/revisions` | 管理员 | 最近的全站版本记录 |
| GET | `/api/wiki/stats` | 管理员 | 统计（总数/已发布/草稿/归档/分类/浏览/近 30 天更新/活跃编辑者/FTS 状态） |
| POST | `/api/wiki` | 管理员 | 新建页面（自动建 revision + 解析内链 + 建索引） |
| PUT | `/api/wiki/:id` | 管理员 | 更新页面（内容变化则新增 revision） |
| POST | `/api/wiki/:id/publish` | 管理员 | 发布（body 带 `notify:true` 时通知全员） |
| POST | `/api/wiki/:id/archive` | 管理员 | 归档（游客与搜索都不可见） |
| POST | `/api/wiki/:id/restore` | 管理员 | 从归档恢复（默认回草稿，可 `status:'published'`） |
| POST | `/api/wiki/:id/revisions/:revisionId/restore` | 管理员 | 恢复历史版本（生成新 revision） |
| DELETE | `/api/wiki/:id` | 超级管理员 | 彻底删除（连带 revisions / links / 索引） |
| POST | `/api/wiki/preview` | 管理员 | 预览（渲染内链与短代码，不落库） |
| POST/PUT | `/api/wiki/categories`、`/api/wiki/categories/:id` | 管理员 | 新建 / 修改分类 |
| DELETE | `/api/wiki/categories/:id` | 超级管理员 | 删除分类（有子分类或文章时拒绝） |

## 4. 权限模型

| 角色 | 能力 |
| --- | --- |
| 游客 | 浏览已发布页面、分类、搜索、查看历史版本 |
| 普通成员（level 0） | 同上（Wiki 不开放普通成员编辑，保持资料权威性） |
| 管理员（level ≥ 1） | 新建/编辑/发布/归档/恢复、管理分类、恢复历史版本 |
| 超级管理员（level ≥ 2） | 额外拥有：彻底删除页面、删除分类 |

判定一律走既有中间件（`middleware/auth.js`）：`authMiddleware` 校验 JWT，`adminMiddleware` / `superAdminMiddleware`
**实时查库**读取 `users.level`，不信任 JWT 里的旧 level。

## 5. 编辑与内链

- 编辑器：`components/WikiRichEditor.jsx`（Tiptap 3），在帖子编辑器基础上扩展表格、任务清单、代码块高亮（lowlight）、
  多图/粘贴/拖拽上传、图注；帖子编辑器 `RichTextEditor.jsx` 保持不动。
- **内链**：正文里写 `[[页面名]]`（可 `[[页面名|显示文字]]`）。编辑器输入 `[[` 会实时弹出页面搜索补全；
  保存时服务端把 `[[...]]` 解析成 `<a href="/wiki/<slug>" class="wiki-link">`，目标不存在时渲染成
  「待创建」红链（点击进入新建页并带上标题），并把命中关系写入 `wiki_page_links`。
- **短代码**：`{{member:123}}` 或 `{{member:用户名}}` → 成员卡片；`{{generation:第五期}}` → 代系卡片
  （带区间与手动归属人数）。这两者在**读取时**渲染，保证成员昵称/头像变化后页面自动最新。
- **图片来源**：走既有 `POST /api/upload`（七牛），编辑器插入的是七牛 URL。

## 6. 搜索

- 输入 ≥3 字：`wiki_search MATCH "关键词"`（trigram），按 `rank` 相关度排序，返回 `snippet()` 片段；
- 输入 <3 字：退回 `title/summary/content LIKE`（标题命中优先）；
- 支持 `category=` 分类过滤（含子分类）、`page/limit` 分页、空查询返回最近更新；
- 首页/搜索页的输入框有 250ms 防抖实时下拉，`Ctrl/⌘ + K` 聚焦。

## 7. 版本（revision）

- 新建页面 → 写 1 条 `创建页面` revision；
- 每次保存，只要 title/content/summary 有变化 → 写一条 revision（备注来自编辑器的「修改备注」）；
- 恢复历史版本 → **先写入一条新 revision**（备注 `恢复自版本 #N（时间）`）再应用到页面，历史永不覆盖；
- 历史页支持「查看」「与当前对比（行级 diff）」「恢复」；后台「历史版本」分页可看全站最近记录。

## 8. 性能与安全

- 首页只取聚合数据（精选 6 / 最近 10 / 热门 10 / 贡献者 8），列表一律分页（默认 20，上限 100），相关文章上限 10；
- 浏览量：进程内 30 分钟去重（同一用户/IP 重复刷新不涨），不引入 Redis；
- 内容：`sanitize-html` 白名单消毒（脚本、事件属性、`javascript:` 一律剥离；外链自动加 `rel="noopener noreferrer"`）；
- 接口：参数长度/类型校验、slug 白名单正则、分类删除保护、写操作全套中间件、全局 `express-rate-limit` 与 `helmet` 继续生效；
- SEO：文章页动态写入 `<title>`、`meta description`、Open Graph、Twitter Card 与 `canonical`（`lib/seo.js`）。

## 9. 迁移与部署

```bash
# 已有环境（幂等，可重复执行）
node scripts/migrate-wiki.js

# 通知类型白名单（若还没执行过含 wiki 的版本）
node scripts/migrate-notification-types.js

# 新环境：npm run init-db 已内联调用 Wiki 迁移

# 自测（临时库 + 临时进程 + 真实 HTTP，跑完自动清理）
node scripts/test-wiki.js
```

生产依赖新增：`pinyin-pro`、`sanitize-html`（部署时需 `npm install`）。
前端新增样式 `styles/wiki.css`，由 `main.jsx` 引入；导航入口在 `Layout.jsx` 的「内容」组，首页入口在 `Home.jsx`。

## 10. 种子数据（公会通史）

`scripts/seed-wiki.js` 消费 `scripts/seed/history.js`：从《玄剑公会通史0517》docx 解析出
「14 章时期 + 纪年表 / 序与玄剑史诗 / 主要人员档案 / 创始人结语」共 18 页真实史料，
内置图片经 `sharp` 压缩后上传七牛并按原位插入；脚本幂等（按标题更新而不是重复创建），
页脚标注来源。执行方式：

```bash
node scripts/seed-wiki.js --dry-run     # 只解析与统计，不写库、不上传
node scripts/seed-wiki.js               # 正式导入（会写库 + 上传图片）
node scripts/seed-wiki.js --no-images   # 跳过图片上传（图片位置留占位）
```
