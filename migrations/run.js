#!/usr/bin/env node
/**
 * 数据库迁移执行器（幂等，支持 --dry-run / --backup / --db=）
 *
 * 约定：
 *   - 迁移文件放在 migrations/ 下，命名 <3-4 位数字>_<slug>.js，按数字升序执行；
 *   - 每个文件导出 { id, name, up(db), down?(db) }，up 的 db 参数形状与 database.js 实例一致：
 *       db.get(sql, params) / db.all / db.run / db.exec(sql) / db.transaction(fn) —— 全部返回 Promise
 *   - 记录表 schema_migrations(id TEXT PRIMARY KEY, name, applied_at)，已应用跳过，可重复执行；
 *   - 每个迁移在独立事务中执行，失败回滚并退出（不影响其他迁移的已应用状态）。
 *
 * 用法：
 *   node migrations/run.js                   # 执行全部未应用迁移
 *   node migrations/run.js --dry-run         # 只列出待执行迁移
 *   node migrations/run.js --backup          # 执行前用 VACUUM INTO 备份数据库
 *   node migrations/run.js --db=data/xx.db   # 指定数据库（测试用；相对仓库根目录）
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, '..');
const MIGRATION_RE = /^(\d{3,4})[_-].+\.js$/;

function parseArgs(argv) {
    const out = { dryRun: false, backup: false, db: null };
    for (const arg of argv.slice(2)) {
        if (arg === '--dry-run') out.dryRun = true;
        else if (arg === '--backup') out.backup = true;
        else if (arg.startsWith('--db=')) out.db = arg.slice(5);
        else if (arg === '--help' || arg === '-h') out.help = true;
        else throw new Error(`未知参数：${arg}`);
    }
    return out;
}

function resolveDbPath(args) {
    const rel = args.db || process.env.DB_FILE || 'data/guild.db';
    return path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
}

function now() {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d - offset).toISOString().slice(0, 19).replace('T', ' ');
}

class Connection {
    constructor(file) {
        this.file = file;
        this.db = new sqlite3.Database(file);
    }
    _promisify(method, sql, params) {
        return new Promise((resolve, reject) => {
            this.db[method](sql, params, (err, result) => (err ? reject(err) : resolve(result)));
        });
    }
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
        });
    }
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
        });
    }
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }
    exec(sql) {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err) => (err ? reject(err) : resolve()));
        });
    }
    async transaction(fn) {
        await this.exec('BEGIN TRANSACTION');
        try {
            const r = await fn(this);
            await this.exec('COMMIT');
            return r;
        } catch (e) {
            try { await this.exec('ROLLBACK'); } catch (e2) { /* 事务可能已结束 */ }
            throw e;
        }
    }
    close() {
        return new Promise((resolve) => this.db.close(() => resolve()));
    }
}

function discoverMigrations() {
    const files = fs.readdirSync(__dirname)
        .filter(f => MIGRATION_RE.test(f))
        .sort((a, b) => Number(a.match(MIGRATION_RE)[1]) - Number(b.match(MIGRATION_RE)[1]));
    return files.map(f => {
        const m = f.match(MIGRATION_RE);
        const id = m[1];
        const mod = require(path.join(__dirname, f));
        if (!mod || typeof mod.up !== 'function') {
            throw new Error(`迁移文件 ${f} 必须导出 { up(db) }`);
        }
        const declaredId = mod.id === undefined ? id : String(mod.id).padStart(id.length, '0');
        if (declaredId !== id) {
            throw new Error(`迁移文件 ${f} 的 id(${mod.id}) 与文件名编号(${id})不一致`);
        }
        return { file: f, id, name: mod.name || f.replace(/\.js$/, ''), up: mod.up };
    });
}

async function backupDatabase(dbFile) {
    const dir = path.join(path.dirname(dbFile), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const target = path.join(dir, `${path.basename(dbFile, '.db')}.bak-${stamp}.db`);
    const conn = new Connection(dbFile);
    try {
        await conn.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } finally {
        await conn.close();
    }
    return target;
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log('用法: node migrations/run.js [--dry-run] [--backup] [--db=path]');
        return;
    }
    const dbFile = resolveDbPath(args);
    if (!fs.existsSync(dbFile)) {
        console.error(`数据库不存在: ${dbFile}`);
        process.exit(1);
    }

    const migrations = discoverMigrations();
    const conn = new Connection(dbFile);
    try {
        await conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )`);
        const appliedRows = await conn.all('SELECT id FROM schema_migrations');
        const applied = new Set(appliedRows.map(r => String(r.id)));
        const pending = migrations.filter(m => !applied.has(m.id));

        console.log(`数据库: ${dbFile}`);
        console.log(`迁移总数: ${migrations.length}，已应用: ${applied.size}，待应用: ${pending.length}`);
        if (!pending.length) {
            console.log('没有待执行的迁移。');
            return;
        }
        for (const m of pending) console.log(`  - [${m.id}] ${m.name} (${m.file})`);
        if (args.dryRun) {
            console.log('--dry-run：不执行。');
            return;
        }
        if (args.backup) {
            const target = await backupDatabase(dbFile);
            console.log(`已备份数据库 → ${target}`);
        }

        for (const m of pending) {
            const start = Date.now();
            try {
                await conn.transaction(async (tx) => {
                    await m.up(tx);
                    await tx.run(
                        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
                        [m.id, m.name, now()]
                    );
                });
                console.log(`✔ [${m.id}] ${m.name}（${Date.now() - start}ms）`);
            } catch (e) {
                console.error(`✘ [${m.id}] ${m.name} 执行失败，已回滚：${e.message}`);
                if (e.stack) console.error(e.stack);
                process.exitCode = 1;
                return;
            }
        }
        console.log('全部迁移执行完成。');
    } finally {
        await conn.close();
    }
}

main().catch((e) => {
    console.error('迁移执行器异常:', e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
});
