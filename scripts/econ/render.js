/**
 * 由 collect.js 产出的 JSON 生成 HTML 报告（表格 + 折线图）
 * 用法：node scripts/econ/render.js
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', '..', 'reports');
const files = fs.readdirSync(OUT_DIR).filter(f => /^econ-.*\.json$/.test(f)).sort();
if (!files.length) { console.error('未找到 collect.js 产出的 JSON，请先运行 collect.js'); process.exit(1); }
const src = path.join(OUT_DIR, files[files.length - 1]);
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const { range, products, rows } = data;

const dates = rows.map(r => r.date);
const shortDates = dates.map(d => d.slice(5)); // MM-DD
const n = (v, p = 2) => Number(v).toFixed(p);

// 有营业额且在区间内的上架标记
const PALETTE = ['#e6194b', '#3cb44b', '#f58231', '#911eb4', '#0082c8', '#800000'];
const markers = products
    .filter(p => p.listedDate && p.listedDate >= range.START && p.listedDate <= range.END)
    .map((p, i) => ({
        name: p.name,
        date: p.listedDate,
        index: dates.indexOf(p.listedDate),
        color: PALETTE[i % PALETTE.length],
        revenue: p.revenue,
        orders: p.orders,
    }));

const markerLegend = markers.map(m =>
    `<span class="mk"><i style="background:${m.color}"></i>${m.name} 上架 ${m.date}</span>`).join('');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 表格 ----------
const tableHead = ['日期', '参与率', '消费率', '流通速度', '总量增速', '基尼系数', '活跃人数', '总存量', '流入量', '流出量', '近30天活跃', '累计完成任务人数'];
const tableRows = rows.map(r => `<tr>
  <td class="d">${r.date}</td>
  <td>${n(r.participation * 100, 1)}%</td>
  <td>${n(r.consumption * 100, 1)}%</td>
  <td>${n(r.velocity, 3)}</td>
  <td>${n(r.growth * 100, 1)}%</td>
  <td>${n(r.gini, 4)}</td>
  <td>${r.activeUsers}</td>
  <td>${n(r.supply)}</td>
  <td>${n(r.inflow)}</td>
  <td>${n(r.outflow)}</td>
  <td>${r.active30}</td>
  <td>${r.taskDone}</td>
</tr>`).join('');

const prodRows = products.map(p => `<tr>
  <td>${esc(p.name)}</td>
  <td>${esc(p.kind)}</td>
  <td>${p.price == null ? '-' : n(p.price)}</td>
  <td class="d">${esc(p.listedAt)}</td>
  <td>${p.orders}</td>
  <td>${n(p.revenue)}</td>
  <td class="d">${esc(p.firstOrderAt)}</td>
  <td class="d">${esc(p.lastOrderAt)}</td>
  <td>${p.active ? '在售' : '已下架'}</td>
</tr>`).join('');

// ---------- 图表数据 ----------
const series = [
    { id: 'participation', title: '参与率', unit: '%', data: rows.map(r => +(r.participation * 100).toFixed(2)), color: '#2563eb', desc: '完成≥1次任务的成员数 ÷ 近30天活跃成员数' },
    { id: 'consumption', title: '消费率', unit: '%', data: rows.map(r => +(r.consumption * 100).toFixed(2)), color: '#dc2626', desc: '累计流出 ÷ 累计获得' },
    { id: 'velocity', title: '流通速度', unit: '次/周期', data: rows.map(r => +r.velocity.toFixed(4)), color: '#059669', desc: '近14天流出 ÷ 平均流通存量' },
    { id: 'growth', title: '总量增速', unit: '%', data: rows.map(r => +(r.growth * 100).toFixed(2)), color: '#d97706', desc: '近14天新增 ÷ 期初存量' },
    { id: 'gini', title: '基尼系数', unit: '', data: rows.map(r => +r.gini.toFixed(4)), color: '#7c3aed', desc: '按成员当日余额计算（仅计余额>0）' },
    { id: 'activeUsers', title: '每天活跃人数', unit: '人', data: rows.map(r => r.activeUsers), color: '#0891b2', desc: '当日有签到或有贡献点流水的去重人数' },
    { id: 'supply', title: '贡献点总存量', unit: '点', data: rows.map(r => r.supply), color: '#b45309', desc: '当日结束时全员贡献点余额合计（由当前存量反向回推）' },
    { id: 'inflow', title: '每日流入量', unit: '点', data: rows.map(r => r.inflow), color: '#16a34a', desc: '当日 amount>0 的流水合计' },
    { id: 'outflow', title: '每日流出量', unit: '点', data: rows.map(r => r.outflow), color: '#e11d48', desc: '当日 amount<0 的流水绝对值合计' },
];

const normalize = (arr) => {
    const mn = Math.min(...arr), mx = Math.max(...arr);
    if (mx === mn) return arr.map(() => 50);
    return arr.map(v => +(((v - mn) / (mx - mn)) * 100).toFixed(2));
};

const chartDivs = series.map(s => `
  <section class="card">
    <h3>${esc(s.title)}${s.unit ? ` <small>(${esc(s.unit)})</small>` : ''}</h3>
    <p class="desc">${esc(s.desc)}</p>
    <div class="canvas-wrap"><canvas id="c-${s.id}"></canvas></div>
  </section>`).join('');

const payload = JSON.stringify({
    labels: shortDates,
    fullDates: dates,
    markers,
    series: series.map(s => ({ id: s.id, title: s.title, unit: s.unit, color: s.color, data: s.data })),
    supply: rows.map(r => r.supply),
    inflow: rows.map(r => r.inflow),
    outflow: rows.map(r => r.outflow),
    allNormalized: series.map(s => ({ id: s.id, title: s.title, unit: s.unit, color: s.color, data: normalize(s.data) })),
});

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>玄剑公会 经济面板数据 ${range.START} ~ ${range.END}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root { --bd:#e2e8f0; --bg:#f7f9fc; --fg:#1e293b; --mut:#64748b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; line-height:1.6; }
  .wrap { max-width:1280px; margin:0 auto; padding:28px 20px 80px; }
  h1 { font-size:24px; margin:0 0 6px; }
  h2 { font-size:18px; margin:36px 0 12px; padding-bottom:6px; border-bottom:2px solid var(--bd); }
  h3 { font-size:15px; margin:0 0 2px; }
  h3 small { color:var(--mut); font-weight:400; }
  .meta { color:var(--mut); font-size:13px; margin-bottom:8px; }
  .note { background:#fff; border:1px solid var(--bd); border-left:4px solid #2563eb; border-radius:8px; padding:12px 16px; font-size:13px; color:#334155; margin:14px 0; }
  .note b { color:#0f172a; }
  table { width:100%; border-collapse:collapse; background:#fff; font-size:13px; }
  .scroll { overflow:auto; max-height:560px; border:1px solid var(--bd); border-radius:8px; }
  th, td { padding:6px 10px; border-bottom:1px solid var(--bd); text-align:right; white-space:nowrap; }
  th { position:sticky; top:0; background:#f1f5f9; z-index:2; text-align:right; font-weight:600; }
  th:first-child, td:first-child, td:first-child + td { text-align:left; }
  td.d { font-variant-numeric:tabular-nums; color:var(--mut); }
  tbody tr:hover { background:#f8fafc; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(430px,1fr)); gap:16px; }
  .card { background:#fff; border:1px solid var(--bd); border-radius:10px; padding:14px 16px 10px; }
  .desc { color:var(--mut); font-size:12px; margin:0 0 8px; }
  .canvas-wrap { position:relative; height:250px; }
  .legend-markers { font-size:12px; color:#475569; margin:8px 0 14px; display:flex; flex-wrap:wrap; gap:14px; }
  .mk { display:inline-flex; align-items:center; gap:5px; }
  .mk i { display:inline-block; width:14px; height:0; border-top:2px dashed currentColor; }
  .mk i { border-top:none; height:10px; width:3px; border-radius:2px; }
  footer { margin-top:40px; color:var(--mut); font-size:12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>玄剑公会 · 经济面板数据</h1>
  <div class="meta">统计区间：<b>${range.START} ~ ${range.END}</b>（${rows.length} 天） · 数据源：2026-09-13 04:30 导出的 guild.db · 时间口径：库内时间（服务器 UTC）</div>

  <div class="note">
    <b>口径说明</b>：五项监控参数与 <code>routes/economics.js</code> 一致——
    参与率＝完成任务成员数/近30天活跃成员数；消费率＝累计流出/累计获得；
    流通速度＝近14天流出/平均流通存量；总量增速＝近14天新增/期初存量；基尼系数＝按成员当日余额计算。<br>
    <b>存量回推</b>：逐日总存量由「导出时点总存量 − 该日之后的流水净额」反推得到，日粒度与流水账完全对齐。
  </div>

  <h2>一、逐日数据表</h2>
  <div class="scroll"><table>
    <thead><tr>${tableHead.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table></div>

  <h2>二、有营业额的商品与上架时间</h2>
  <div class="scroll"><table>
    <thead><tr><th>名称</th><th>类型</th><th>单价</th><th>上架时间</th><th>订单数</th><th>营业额</th><th>首单时间</th><th>末单时间</th><th>状态</th></tr></thead>
    <tbody>${prodRows}</tbody>
  </table></div>
  <div class="legend-markers">折线图上的竖虚线＝商品上架时点：${markerLegend || '(区间内无上架事件)'}</div>

  <h2>三、单项折线图（每项一张）</h2>
  <div class="grid">${chartDivs}</div>

  <h2>四、贡献点总存量 + 流入量 + 流出量</h2>
  <div class="grid">
    <section class="card">
      <h3>存量 / 流入 / 流出 <small>(存量看左轴，流入流出看右轴)</small></h3>
      <p class="desc">存量（金色，左轴）与每日流入（绿）、流出（红，右轴）对照，可直接看出每次流入高峰对存量的推动。</p>
      <div class="canvas-wrap" style="height:320px"><canvas id="c-combined"></canvas></div>
    </section>
  </div>

  <h2>五、全部指标融合</h2>
  <div class="grid">
    <section class="card">
      <h3>全部指标（归一化 0–100）</h3>
      <p class="desc">各指标量纲差异过大（存量≈千点、活跃人数≈十人、比率≈0–1），故统一做 min-max 归一化后同图对比，<b>只能看趋势不能读绝对值</b>；绝对值见上方表格与各自单图。</p>
      <div class="canvas-wrap" style="height:400px"><canvas id="c-all"></canvas></div>
    </section>
  </div>

  <footer>生成时间：${new Date().toISOString()} · 由 scripts/econ/collect.js + render.js 生成</footer>
</div>

<script>
const D = ${payload};

// 上架时点竖虚线插件（画在每个图上）
const listingMarkers = {
  id: 'listingMarkers',
  afterDatasetsDraw(chart, args, opts) {
    const items = (opts && opts.items) || [];
    if (!items.length) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    items.forEach((it) => {
      if (it.index < 0) return;
      const px = x.getPixelForValue(it.index);
      if (px < chartArea.left - 1 || px > chartArea.right + 1) return;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 1.5;
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.translate(px, chartArea.top + 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = it.color;
      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.name + ' 上架', -2, -3);
      ctx.restore();
    });
  }
};
Chart.register(listingMarkers);

const baseOpts = (title, unit) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    listingMarkers: { items: D.markers },
    tooltip: {
      callbacks: {
        title: (items) => D.fullDates[items[0].dataIndex],
        label: (c) => ' ' + title + '：' + c.formattedValue + (unit || ''),
      }
    }
  },
  scales: {
    x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16, font: { size: 11 } }, grid: { display: false } },
    y: { beginAtZero: false, ticks: { font: { size: 11 } } }
  }
});

const fillLine = (label, data, color, fill) => ({
  label, data,
  borderColor: color,
  backgroundColor: color + (fill ? '22' : '00'),
  borderWidth: 2,
  pointRadius: 2.5,
  pointHoverRadius: 5,
  tension: 0.25,
  fill: !!fill,
});

// 九张单图
D.series.forEach(s => {
  const cv = document.getElementById('c-' + s.id);
  new Chart(cv, {
    type: 'line',
    data: { labels: D.labels, datasets: [fillLine(s.title, s.data, s.color, true)] },
    options: baseOpts(s.title, s.unit),
  });
});

// 存量 + 流入 + 流出（双轴）
new Chart(document.getElementById('c-combined'), {
  type: 'line',
  data: {
    labels: D.labels,
    datasets: [
      { ...fillLine('贡献点总存量', D.supply, '#b45309', true), yAxisID: 'y' },
      { ...fillLine('流入量', D.inflow, '#16a34a', false), yAxisID: 'y1' },
      { ...fillLine('流出量', D.outflow, '#e11d48', false), yAxisID: 'y1' },
    ]
  },
  options: {
    ...baseOpts('', ''),
    plugins: {
      ...baseOpts('', '').plugins,
      legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
    },
    scales: {
      x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16, font: { size: 11 } }, grid: { display: false } },
      y: { position: 'left', title: { display: true, text: '总存量(点)', font: { size: 11 } }, ticks: { font: { size: 11 } } },
      y1: { position: 'right', title: { display: true, text: '流入/流出(点)', font: { size: 11 } }, grid: { drawOnChartArea: false }, ticks: { font: { size: 11 } } },
    }
  }
});

// 全部融合（归一化）
new Chart(document.getElementById('c-all'), {
  type: 'line',
  data: {
    labels: D.labels,
    datasets: D.allNormalized.map(s => fillLine(s.title, s.data, s.color, false)),
  },
  options: {
    ...baseOpts('', ''),
    plugins: {
      legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      listingMarkers: { items: D.markers },
      tooltip: {
        callbacks: {
          title: (items) => D.fullDates[items[0].dataIndex],
          label: (c) => ' ' + c.dataset.label + '（归一化）：' + c.formattedValue,
        }
      }
    },
    scales: {
      x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16, font: { size: 11 } }, grid: { display: false } },
      y: { min: 0, max: 100, title: { display: true, text: '归一化 0–100', font: { size: 11 } }, ticks: { font: { size: 11 } } },
    }
  }
});
</script>
</body>
</html>`;

const out = path.join(OUT_DIR, `econ-${range.START}_${range.END}.html`);
fs.writeFileSync(out, html, 'utf8');
console.log('已生成: ' + out);
console.log('图表数量: ' + (series.length + 2) + '（单项 ' + series.length + ' + 存量流入流出 1 + 全部融合 1）');
console.log('上架标记: ' + markers.map(m => `${m.name}@${m.date}`).join(', '));
