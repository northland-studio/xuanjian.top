# 数据库迁移

本目录是 xuanjian.top 的数据库迁移脚本集合，由 `migrations/run.js` 统一执行。

## 执行

```bash
node migrations/run.js                 # 执行全部未应用迁移（幂等，已应用跳过）
node migrations/run.js --dry-run       # 只列出待执行迁移
node migrations/run.js --backup        # 执行前用 VACUUM INTO 备份整库到 data/backups/
node migrations/run.js --db=data/xx.db # 指定数据库（测试用，相对仓库根目录）
```

记录表：`schema_migrations(id TEXT PRIMARY KEY, name TEXT, applied_at TEXT)`。
每个迁移在独立事务中执行，失败回滚并终止。

## 文件约定

- 命名：`<3-4 位数字>_<slug>.js`，按数字前缀升序执行；
- 导出：`module.exports = { id, name, up: async (db) => {}, down?: async (db) => {} }`；
- `up(db)` 的 `db` 与本项目 `database.js` 实例形状一致：
  `db.get(sql, params)` / `db.all` / `db.run` / `db.exec(sql)` / `db.transaction(fn)`，全部返回 Promise；
- 迁移必须**自身幂等**（`CREATE TABLE IF NOT EXISTS` / `PRAGMA table_info` 判断后 `ALTER`），可重复执行；
- 已执行的迁移不要改动语义（需要修正时新增编号）。

## 编号分配（多团队并行）

| 编号 | 归属 | 内容 |
|---|---|---|
| 100-119 | permissions-engineer | 权限体系（表、注册表同步、系统角色、经济成员回填、审计字段） |
| 120-139 | gis-platform | GIS（World Registry、道路/城区、地形、历史快照、集市地点） |
| 140+ | 待分配 | 后续模块 |

> `run.js` 由 permissions-engineer 独占维护，其他同学只新增自己的编号文件，不要修改 `/run.js`。
