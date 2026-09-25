// NorthTeam 1.1.0 配套迁移：team_configs 增加 scoreboard_unit_scores（fixed 模式的每队固定分）
// 用法：node scripts/migrate-team-unit-scores.js
// 说明：字段内容为 JSON 文本，形如 {"yellow":10,"red":8}；老数据默认 '{}'，插件会回退为“按人数”。
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'guild.db');
const db = new sqlite3.Database(DB_PATH);

console.log('开始 team_configs.scoreboard_unit_scores 字段迁移...');

db.serialize(() => {
    db.run("ALTER TABLE team_configs ADD COLUMN scoreboard_unit_scores TEXT DEFAULT '{}'", (err) => {
        if (err && !/duplicate column/i.test(err.message)) {
            console.error('添加 scoreboard_unit_scores 列失败:', err.message);
            process.exitCode = 1;
        } else if (err) {
            console.log('scoreboard_unit_scores 列已存在，跳过');
        } else {
            console.log('scoreboard_unit_scores 列已添加');
        }
    });

    // 老数据回填空对象，保证插件侧 parseUnitScores 拿到的是合法 JSON
    db.run("UPDATE team_configs SET scoreboard_unit_scores = '{}' WHERE scoreboard_unit_scores IS NULL", function (err) {
        if (err) {
            console.error('回填默认值失败:', err.message);
        } else {
            console.log(`已回填 ${this.changes} 行默认值（NULL → '{}'）`);
        }
    });

    db.all('SELECT id, name, scoreboard_score_mode, scoreboard_unit_scores FROM team_configs ORDER BY id', (err, rows) => {
        if (err) {
            console.error('校验读取失败:', err.message);
            return;
        }
        console.log(`当前 team_configs 共 ${rows.length} 条：`);
        for (const r of rows) {
            console.log(`  #${r.id} ${r.name}  score_mode=${r.scoreboard_score_mode}  unit_scores=${r.scoreboard_unit_scores}`);
        }
    });
});

setTimeout(() => {
    db.close();
    console.log('迁移完成。');
}, 1200);
