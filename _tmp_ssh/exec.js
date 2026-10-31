const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("ssh2");
const cmdFile = process.argv[2];
if (!cmdFile) { console.error("用法: node exec.js <脚本文件>"); process.exit(2); }
const command = fs.readFileSync(path.resolve(cmdFile), "utf8");
const conn = new Client();
conn.on("ready", () => {
  conn.exec("bash -s", (err, stream) => {
    if (err) { console.error("exec 失败: " + err.message); conn.end(); process.exit(1); }
    stream.on("close", (code) => { conn.end(); process.exit(code || 0); })
      .on("data", (d) => process.stdout.write(d))
      .stderr.on("data", (d) => process.stderr.write(d));
    stream.end(command);
  });
}).on("error", (e) => { console.error("连接失败: " + e.message); process.exit(1); })
  .connect({ host: "43.248.3.161", port: 20043, username: "root", password: "UwLfkUu5Ngps", readyTimeout: 25000, keepaliveInterval: 10000 });
