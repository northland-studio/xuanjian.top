/**
 * 本地 Web GUI：原版 MC 镜像同步进度
 * 用法：node scripts/mc-mirror/gui-server.js  → 打开 http://127.0.0.1:8790
 *
 * 依赖环境变量（由 start-gui.ps1 注入）：
 *   QINIU_ACCESS_KEY / QINIU_SECRET_KEY / MIRROR_BUCKET / MIRROR_UPLOAD_HOST / APP_DIR
 */
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.GUI_PORT || 8790);
const SYNC = path.join(__dirname, 'sync-mc-mirror.js');
const PRESET = ['26.2', '26.1.2', '1.20.1', '1.21.11', '1.12.2', '1.16.5'];

const state = {
    running: false,
    versions: [],
    current: '',
    stage: '等待开始',
    upload: 0,
    skip: 0,
    fail: 0,
    assetsTotal: 0,
    startedAt: 0,
    finishedAt: 0,
    rate: 0,
    pid: null
};
const logs = [];
let child = null;
const clients = new Set();

function log(line) {
    const item = { t: Date.now(), line };
    logs.push(item);
    if (logs.length > 2000) logs.shift();
    broadcast({ type: 'log', ...item });
}
function broadcast(payload) {
    const data = 'data: ' + JSON.stringify(payload) + '\n\n';
    for (const res of clients) {
        try { res.write(data); } catch { clients.delete(res); }
    }
}
function pushState() { broadcast({ type: 'state', state }); broadcast({ type: 'versions', versions: state.versions }); }

function parse(line) {
    let m;
    if ((m = line.match(/^===== (.+) =====$/))) {
        state.current = m[1];
        state.stage = m[1] === '完成' ? '完成' : '准备中';
        pushState();
    } else if ((m = line.match(/资源: 上传 (\d+) \/ 跳过 (\d+) \/ 失败 (\d+)/))) {
        state.upload = +m[1]; state.skip = +m[2]; state.fail = +m[3]; state.stage = '资源已传，准备 assets'; pushState();
    } else if ((m = line.match(/assets 对象: (\d+) 个/))) {
        state.assetsTotal = +m[1]; state.stage = '上传 assets'; pushState();
    } else if ((m = line.match(/… 已上传 (\d+)，跳过 (\d+)，失败 (\d+)/))) {
        state.upload = +m[1]; state.skip = +m[2]; state.fail = +m[3];
        const sec = (Date.now() - state.startedAt) / 1000;
        state.rate = sec > 0 ? state.upload / sec : 0;
        pushState();
    } else if (line.includes('上传 ') && line.includes('个文件，跳过')) {
        const mm = line.match(/上传 (\d+) 个文件，跳过 (\d+) 个，失败 (\d+) 个/);
        if (mm) { state.upload = +mm[1]; state.skip = +mm[2]; state.fail = +mm[3]; }
        state.stage = '完成';
        state.finishedAt = Date.now();
        pushState();
    } else if (line.includes('mc/game/version_manifest_v2.json')) {
        state.stage = '写入版本清单'; pushState();
    }
}

function start(versions, concurrency) {
    if (state.running) return { error: '已有任务在跑' };
    state.running = true;
    state.versions = versions;
    state.current = '';
    state.stage = '启动中';
    state.upload = 0; state.skip = 0; state.fail = 0; state.assetsTotal = 0;
    state.startedAt = Date.now(); state.finishedAt = 0; state.rate = 0;
    pushState();

    const env = {
        ...process.env,
        MIRROR_CONCURRENCY: String(concurrency || 24),
        MIRROR_CACHE: process.env.MIRROR_CACHE || path.join(process.env.TEMP || '/tmp', 'mc-mirror-cache')
    };
    fs.mkdirSync(env.MIRROR_CACHE, { recursive: true });
    child = spawn(process.execPath, [SYNC, ...versions], { env, cwd: path.dirname(SYNC) });
    state.pid = child.pid;
    const onData = (buf) => {
        String(buf).split(/\r?\n/).filter(Boolean).forEach((line) => { log(line); parse(line); });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
        state.running = false;
        state.stage = code === 0 ? '全部完成' : '异常结束（code ' + code + '）';
        state.finishedAt = Date.now();
        log('进程退出，code=' + code);
        pushState();
        child = null;
    });
    return { ok: true };
}

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>MC 镜像同步 · 玄剑</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--border:#2a2f3a;--text:#e6edf3;--sub:#8b98a9;--pri:#2f81f7;--ok:#3fb950;--bad:#f85149;--warn:#d29922}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:20px}
h1{font-size:18px;margin:0 0 4px}.sub{color:var(--sub);font-size:12px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px}
label{font-size:12.5px;color:var(--sub);display:block;margin-bottom:6px}
.vers{display:flex;flex-wrap:wrap;gap:8px}.vers label{display:flex;align-items:center;gap:6px;background:#0f1115;border:1px solid var(--border);border-radius:999px;padding:6px 12px;color:var(--text);cursor:pointer;font-size:13px;margin:0}
.vers input{accent-color:var(--pri)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
input[type=number]{width:80px;background:#0f1115;border:1px solid var(--border);color:var(--text);border-radius:8px;padding:7px 10px}
button{background:var(--pri);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer}
button.ghost{background:#0f1115;border:1px solid var(--border);color:var(--text)}
button:disabled{opacity:.5;cursor:not-allowed}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.stat{background:#0f1115;border:1px solid var(--border);border-radius:8px;padding:10px 12px}
.stat span{display:block;font-size:11.5px;color:var(--sub)}.stat b{font-size:18px;font-variant-numeric:tabular-nums}
.bar{height:8px;background:#0f1115;border:1px solid var(--border);border-radius:999px;overflow:hidden;margin-top:12px}
.bar i{display:block;height:100%;background:linear-gradient(90deg,#2f81f7,#3fb950);width:0;transition:width .3s}
#log{background:#0b0d11;border:1px solid var(--border);border-radius:10px;padding:12px;height:420px;overflow:auto;font:12px/1.7 ui-monospace,Consolas,monospace;white-space:pre-wrap}
.l-err{color:var(--bad)}.l-ok{color:var(--ok)}.l-dim{color:var(--sub)}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;border:1px solid var(--border);color:var(--sub)}
.badge.run{color:var(--ok);border-color:#2ea043}
</style></head><body><div class="wrap">
<h1>Minecraft 原版镜像同步 <span id="badge" class="badge">空闲</span></h1>
<div class="sub">Mojang → 七牛 <span id="bucket"></span> · 上传走加速域名</div>

<div class="card">
  <label>要同步的版本</label>
  <div class="vers" id="vers"></div>
  <div class="row">
    <label style="margin:0">并发</label><input type="number" id="conc" value="24" min="1" max="64">
    <button id="start">开始同步</button>
    <button id="stop" class="ghost" disabled>停止</button>
    <button id="clear" class="ghost">清空日志</button>
  </div>
</div>

<div class="card">
  <div class="stats">
    <div class="stat"><span>当前版本</span><b id="cur">—</b></div>
    <div class="stat"><span>阶段</span><b id="stage">—</b></div>
    <div class="stat"><span>已上传</span><b id="up">0</b></div>
    <div class="stat"><span>已跳过</span><b id="sk">0</b></div>
    <div class="stat"><span>失败</span><b id="fa">0</b></div>
    <div class="stat"><span>assets 总数</span><b id="tot">0</b></div>
    <div class="stat"><span>速率</span><b id="rate">0</b></div>
    <div class="stat"><span>已用时</span><b id="elapsed">0s</b></div>
  </div>
  <div class="bar"><i id="bar"></i></div>
</div>

<div id="log"></div>

<script>
var PRESET = ${JSON.stringify(PRESET)};
var state = {}, started = 0, timer = null;
function $(id){return document.getElementById(id)}
function fmt(n){return Number(n||0).toLocaleString()}
function renderVers(sel){
  $('vers').innerHTML = PRESET.map(function(v){
    var on = !sel || sel.indexOf(v) >= 0;
    return '<label><input type="checkbox" value="'+v+'"'+(on?' checked':'')+'>'+v+'</label>';
  }).join('');
}
function logLine(item){
  var el=document.createElement('div');
  el.textContent=new Date(item.t).toLocaleTimeString()+'  '+item.line;
  if(/✗|失败|error/i.test(item.line)) el.className='l-err';
  else if(/✓|完成/.test(item.line)) el.className='l-ok';
  else if(/=====/.test(item.line)) el.className='l-dim';
  var box=$('log'), stick=box.scrollTop+box.clientHeight>=box.scrollHeight-30;
  box.appendChild(el);
  while(box.childNodes.length>3000) box.removeChild(box.firstChild);
  if(stick) box.scrollTop=box.scrollHeight;
}
function apply(s){
  state=s;
  $('badge').textContent = s.running ? '运行中' : '空闲';
  $('badge').className = 'badge'+(s.running?' run':'');
  $('cur').textContent = s.current||'—';
  $('stage').textContent = s.stage||'—';
  $('up').textContent = fmt(s.upload); $('sk').textContent = fmt(s.skip); $('fa').textContent = fmt(s.fail);
  $('tot').textContent = fmt(s.assetsTotal); $('rate').textContent = (s.rate||0).toFixed(1)+'/s';
  var pct = s.assetsTotal ? Math.min(100, (s.upload/s.assetsTotal*100)) : (s.running?5:0);
  $('bar').style.width = pct.toFixed(1)+'%';
  $('start').disabled = s.running; $('stop').disabled = !s.running;
  started = s.startedAt||0;
}
function tick(){
  if(!started) return;
  var end = state.finishedAt || Date.now();
  var sec = Math.max(0, Math.round((end-started)/1000));
  $('elapsed').textContent = sec>3600 ? (sec/3600).toFixed(1)+'h' : sec>60 ? Math.floor(sec/60)+'m'+(sec%60)+'s' : sec+'s';
}
var es = new EventSource('/api/events');
es.onmessage = function(e){
  var d = JSON.parse(e.data);
  if(d.type==='log') logLine(d);
  else if(d.type==='state') apply(d.state);
  else if(d.type==='versions') renderVers(d.versions && d.versions.length ? d.versions : null);
};
$('start').onclick = function(){
  var vs = [].slice.call(document.querySelectorAll('#vers input:checked')).map(function(i){return i.value});
  if(!vs.length) return alert('至少选一个版本');
  fetch('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({versions:vs,concurrency:+$('conc').value})})
    .then(function(r){return r.json()}).then(function(j){ if(j.error) alert(j.error); });
};
$('stop').onclick = function(){ fetch('/api/stop',{method:'POST'}) };
$('clear').onclick = function(){ $('log').innerHTML='' };
renderVers(); setInterval(tick, 1000);
fetch('/api/state').then(function(r){return r.json()}).then(function(j){apply(j.state); renderVers(j.state.versions); (j.logs||[]).forEach(logLine);});
</script></div></body></html>`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ state, logs: logs.slice(-200) }));
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
        let body = '';
        req.on('data', (c) => (body += c));
        return req.on('end', () => {
            let j = {};
            try { j = JSON.parse(body || '{}'); } catch {}
            const versions = Array.isArray(j.versions) && j.versions.length ? j.versions : PRESET;
            const r = start(versions, j.concurrency);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(r));
        });
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
        if (child) { try { child.kill(); } catch {} log('已请求停止'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
    console.log('GUI 已启动: http://127.0.0.1:' + PORT);
    console.log('bucket=' + (process.env.MIRROR_BUCKET || 'xuanjian-mc-mirror') + '  uploadHost=' + (process.env.MIRROR_UPLOAD_HOST || '(SDK 默认)'));
});
