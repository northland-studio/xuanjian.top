const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'data/guild.db');

function getLocalTimestamp() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localTime = new Date(now - offset);
    return localTime.toISOString().slice(0, 19).replace('T', ' ');
}

class Database {
    constructor() {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('数据库连接失败:', err);
            } else {
                this.initPragmas();
            }
        });
    }

    initPragmas() {
        const pragmas = [
            'PRAGMA journal_mode = WAL',
            'PRAGMA synchronous = NORMAL',
            'PRAGMA cache_size = 5000',
            'PRAGMA temp_store = MEMORY',
            'PRAGMA mmap_size = 268435456',
            'PRAGMA foreign_keys = ON'
        ];
        
        pragmas.forEach(pragma => {
            this.db.run(pragma, (err) => {
                if (err) console.error('PRAGMA 设置失败:', pragma, err);
            });
        });
        
        console.log('数据库优化设置已启用: WAL模式, 缓存优化');
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    close() {
        this.db.close();
    }
}

module.exports = new Database();
module.exports.getLocalTimestamp = getLocalTimestamp;
