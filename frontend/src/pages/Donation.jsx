import { useEffect, useState, useCallback } from 'react';
import { api, getToken } from '../api';
import { useToast } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import SkinViewer from '../components/SkinViewer';
import { CardIcon, CheckCircleIcon } from '../components/ChatIcons';
import { fmtPoints } from '../utils';

const PAGE_SIZE = 12;      // 捐赠者卡片每页
const LEDGER_SIZE = 20;    // 明细每页

/**
 * 捐赠墙 /donation
 *  1) 公账余额统计（收入 / 支出 / 余额）+ 收款码
 *  2) 捐赠者卡片：皮肤模型 + 累计捐赠额（随机动作、分页）
 *  3) 出入账明细表（分页 + 方向筛选 + 导出 PDF / Excel）
 */
export default function Donation() {
  const { showToast } = useToast();
  const { user } = useAuth();

  const [summary, setSummary] = useState(null);
  const [qrUrl, setQrUrl] = useState('');
  const [donors, setDonors] = useState([]);
  const [donorTotal, setDonorTotal] = useState(0);
  const [donorPage, setDonorPage] = useState(1);

  const [ledger, setLedger] = useState([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [direction, setDirection] = useState('');

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const isAdmin = (user?.level || 0) >= 1;

  const loadSummary = useCallback(() => {
    api.get('/api/donation/summary')
      .then(d => { setSummary(d.summary); setQrUrl(d.qrUrl || ''); })
      .catch(() => {});
  }, []);

  const loadDonors = useCallback((page) => {
    api.get(`/api/donation/donors?page=${page}&limit=${PAGE_SIZE}`)
      .then(d => { setDonors(d.list || []); setDonorTotal(d.total || 0); })
      .catch(() => {});
  }, []);

  const loadLedger = useCallback((page, dir) => {
    const q = [`page=${page}`, `limit=${LEDGER_SIZE}`];
    if (dir) q.push(`direction=${dir}`);
    api.get(`/api/donation/ledger?${q.join('&')}`)
      .then(d => { setLedger(d.list || []); setLedgerTotal(d.total || 0); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/api/donation/summary').then(d => { setSummary(d.summary); setQrUrl(d.qrUrl || ''); }).catch(() => {}),
      api.get(`/api/donation/donors?page=1&limit=${PAGE_SIZE}`).then(d => { setDonors(d.list || []); setDonorTotal(d.total || 0); }).catch(() => {}),
      api.get(`/api/donation/ledger?page=1&limit=${LEDGER_SIZE}`).then(d => { setLedger(d.list || []); setLedgerTotal(d.total || 0); }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const changeDonorPage = (p) => { setDonorPage(p); loadDonors(p); };
  const changeLedgerPage = (p) => { setLedgerPage(p); loadLedger(p, direction); };
  const changeDirection = (d) => { setDirection(d); setLedgerPage(1); loadLedger(1, d); };

  // ---------- 导出 ----------
  // 导出接口需要 Bearer 鉴权。window.open 不会带 Authorization 头，
  // 必须自己 fetch 拿 blob 再触发下载，否则会报「未提供认证令牌」。
  const downloadAuthed = async (url, fallbackName) => {
    const token = getToken();
    const res = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!res.ok) {
      let msg = `导出失败（HTTP ${res.status}）`;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* 非 JSON 忽略 */ }
      throw new Error(msg);
    }
    let name = fallbackName;
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
    if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }

    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 3000);
  };

  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const qs = direction ? `?direction=${direction}` : '';
      await downloadAuthed(`/api/donation/export/xlsx${qs}`, `捐赠墙公账-${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast('Excel 已导出', 'success');
    } catch (e) {
      showToast(e.message || 'Excel 导出失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const [{ jsPDF }, autoTableMod, { registerCjkFont, CJK_FONT_NAME }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
        import('../lib/pdf-font'),
      ]);
      const autoTable = autoTableMod.default || autoTableMod.autoTable || autoTableMod;

      // 拉全量（分页接口，最多 200/页）
      let all = [], page = 1, total = Infinity;
      while (all.length < total && page <= 20) {
        // eslint-disable-next-line no-await-in-loop
        const d = await api.get(`/api/donation/ledger?page=${page}&limit=200${direction ? `&direction=${direction}` : ''}`);
        all = all.concat(d.list || []);
        total = d.total || 0;
        if (!d.list || d.list.length === 0) break;
        page += 1;
      }
      const donorsAll = await api.get('/api/donation/donors?page=1&limit=60');

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      // 关键：jsPDF 内置字体不含中文字形，必须先注册等线字体，否则 PDF 全篇乱码
      await registerCjkFont(doc);

      const W = doc.internal.pageSize.getWidth();

      doc.setFontSize(16);
      doc.text('玄剑公会 · 捐赠墙公账明细', 40, 40);
      doc.setFontSize(10);
      doc.text(`累计收入：${summary?.income ?? 0} 元    累计支出：${summary?.expense ?? 0} 元    公账余额：${summary?.balance ?? 0} 元`, 40, 58);
      doc.text(`导出时间：${new Date().toLocaleString()}`, 40, 72);

      autoTable(doc, {
        startY: 88,
        head: [['#', '类型', '日期', '捐赠人', '金额(元)', '比例', '发放贡献点', '用处/备注', '材料']],
        body: all.map((r, i) => [
          i + 1,
          r.direction === 'in' ? '入账' : '支出',
          r.occurredOn,
          r.direction === 'in' ? (r.donor?.nickname || '') : '',
          r.amount,
          r.direction === 'in' ? (r.ratio || 0) : '',
          r.direction === 'in' ? (r.points || 0) : '',
          (r.purpose ? r.purpose + ' ' : '') + (r.note || ''),
          (r.materials?.length || 0) + (r.hiddenMaterialCount ? `(+${r.hiddenMaterialCount}私)` : ''),
        ]),
        styles: { font: CJK_FONT_NAME, fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [0, 74, 173], font: CJK_FONT_NAME, fontStyle: 'normal' },
        theme: 'grid',
        margin: { left: 40, right: 40 },
        didDrawPage: (data) => {
          doc.setFont(CJK_FONT_NAME, 'normal');
          doc.setFontSize(8);
          doc.text(`第 ${data.pageNumber} 页`, W - 70, doc.internal.pageSize.getHeight() - 20);
        },
      });

      // 捐赠者汇总另起一页
      doc.addPage();
      await registerCjkFont(doc);
      doc.setFontSize(14);
      doc.text('捐赠者汇总（按累计捐赠额排序）', 40, 40);
      autoTable(doc, {
        startY: 58,
        head: [['#', '捐赠人', '累计捐赠(元)', '累计发放贡献点', '捐赠次数', '最近捐赠']],
        body: (donorsAll.list || []).map((d, i) => [i + 1, d.nickname, d.totalAmount, d.totalPoints, d.times, d.lastOn || '']),
        styles: { font: CJK_FONT_NAME, fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [0, 74, 173], font: CJK_FONT_NAME, fontStyle: 'normal' },
        theme: 'grid',
        margin: { left: 40, right: 40 },
      });

      doc.save(`捐赠墙公账-${new Date().toISOString().slice(0, 10)}.pdf`);
      showToast('PDF 已导出', 'success');
    } catch (e) {
      showToast(e.message || 'PDF 导出失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  const totalPages = (t, size) => Math.max(1, Math.ceil(t / size));

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/2.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>捐赠墙</h1>
          <p>公账公开透明 · 每一笔收入与支出都可查 · 感谢每一位支持公会的成员</p>
        </div>
      </div>

      {/* ===== 公账概览 + 收款码 ===== */}
      <div className="grid grid-2" style={{ gap: 16, alignItems: 'start', marginBottom: 20 }}>
        <div className="card" style={{ padding: 22 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CardIcon size={18} /> 公账概览
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { label: '累计收入', value: summary?.income, color: 'var(--success)' },
              { label: '累计支出', value: summary?.expense, color: 'var(--danger)' },
              { label: '公账余额', value: summary?.balance, color: 'var(--primary)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--input-bg)', borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
                <div className="text-secondary" style={{ fontSize: 12 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: s.color }}>{fmtPoints(s.value ?? 0)}</div>
                <div className="text-secondary" style={{ fontSize: 11 }}>元</div>
              </div>
            ))}
          </div>
          <div className="flex" style={{ gap: 18, marginTop: 14, fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            <span>入账 {summary?.inCount ?? 0} 笔</span>
            <span>支出 {summary?.outCount ?? 0} 笔</span>
            <span>累计发放贡献点 {fmtPoints(summary?.pointsTotal ?? 0)}</span>
          </div>
        </div>

        <div className="card" style={{ padding: 22, textAlign: 'center' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <CheckCircleIcon size={18} /> 捐赠收款码
          </h3>
          {qrUrl ? (
            <img src={qrUrl} alt="捐赠收款码" style={{ maxWidth: 240, width: '100%', borderRadius: 12, border: '1px solid var(--border)' }} />
          ) : (
            <p className="text-secondary" style={{ fontSize: 13, padding: '40px 0' }}>管理员尚未上传收款码</p>
          )}
          <p className="text-secondary" style={{ fontSize: 12, marginTop: 12 }}>
            捐赠后请联系管理员登记，即可计入公账并公示
          </p>
        </div>
      </div>

      {/* ===== 捐赠者卡片 ===== */}
      <div className="card" style={{ padding: 22, marginBottom: 20 }}>
        <div className="flex-between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>捐赠者（共 {donorTotal} 位）</h3>
          <span className="text-secondary" style={{ fontSize: 12 }}>按累计捐赠额排序</span>
        </div>
        {donors.length === 0 ? (
          <div className="empty-state"><p>还没有捐赠记录，期待第一位支持者</p></div>
        ) : (
          <div className="grid grid-4" style={{ gap: 12 }}>
            {donors.map(d => (
              <div key={d.userId} className="card card-hover" style={{ padding: 12, textAlign: 'center', overflow: 'hidden' }}>
                <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--input-bg)', borderRadius: 10 }}>
                  {d.skin ? (
                    <SkinViewer
                      skin={d.skin}
                      width={150}
                      height={190}
                      animation="random"
                      animationSpeed={0.7}
                      zoom={0.95}
                      name={d.gameId || d.nickname}
                      autoRotate={false}
                    />
                  ) : (
                    <div style={{ padding: 12 }}>
                      {d.avatar
                        ? <img src={d.avatar} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
                        : <div style={{ fontSize: 34 }}>·</div>}
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.nickname}
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--primary)', marginTop: 2 }}>
                  {fmtPoints(d.totalAmount)} <span style={{ fontSize: 11, fontWeight: 400 }}>元</span>
                </div>
                <div className="text-secondary" style={{ fontSize: 11, marginTop: 3 }}>
                  捐赠 {d.times} 次 · 获赠 {fmtPoints(d.totalPoints)} 点
                </div>
              </div>
            ))}
          </div>
        )}
        {totalPages(donorTotal, PAGE_SIZE) > 1 && (
          <div className="flex" style={{ gap: 6, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" disabled={donorPage <= 1} onClick={() => changeDonorPage(donorPage - 1)}>上一页</button>
            <span className="text-secondary" style={{ fontSize: 13, alignSelf: 'center' }}>
              第 {donorPage} / {totalPages(donorTotal, PAGE_SIZE)} 页
            </span>
            <button className="btn btn-secondary btn-sm" disabled={donorPage >= totalPages(donorTotal, PAGE_SIZE)} onClick={() => changeDonorPage(donorPage + 1)}>下一页</button>
          </div>
        )}
      </div>

      {/* ===== 出入账明细 ===== */}
      <div className="card" style={{ padding: 22 }}>
        <div className="flex-between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>出入账明细（共 {ledgerTotal} 条）</h3>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {[['', '全部'], ['in', '入账'], ['out', '支出']].map(([v, label]) => (
              <button key={v || 'all'} className={`btn btn-sm ${direction === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => changeDirection(v)}>{label}</button>
            ))}
            <button className="btn btn-secondary btn-sm" disabled={exporting} onClick={exportPdf}>{exporting ? '生成中…' : '导出 PDF'}</button>
            <button className="btn btn-secondary btn-sm" onClick={exportExcel}>导出 Excel</button>
          </div>
        </div>

        {ledger.length === 0 ? (
          <div className="empty-state"><p>暂无记录</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th>日期</th><th>类型</th><th>捐赠人 / 用处</th><th>金额(元)</th>
                  <th>比例</th><th>发放贡献点</th><th>备注</th><th>材料</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map(r => (
                  <tr key={r.id}>
                    <td className="text-secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{r.occurredOn}</td>
                    <td>
                      <span className="badge" style={{
                        background: r.direction === 'in' ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)',
                        color: r.direction === 'in' ? 'var(--success)' : 'var(--danger)',
                      }}>{r.direction === 'in' ? '入账' : '支出'}</span>
                    </td>
                    <td>{r.direction === 'in' ? (r.donor?.nickname || '—') : (r.purpose || '—')}</td>
                    <td style={{ fontWeight: 700, color: r.direction === 'in' ? 'var(--success)' : 'var(--danger)' }}>
                      {r.direction === 'in' ? '+' : '-'}{fmtPoints(r.amount)}
                    </td>
                    <td className="text-secondary">{r.direction === 'in' ? (r.ratio || 0) : '—'}</td>
                    <td className="text-secondary">{r.direction === 'in' ? fmtPoints(r.points) : '—'}</td>
                    <td className="text-secondary" style={{ fontSize: 12, maxWidth: 220 }}>{r.note || '—'}</td>
                    <td>
                      {r.materials?.length ? r.materials.map((m, i) => (
                        m.type === 'image' ? (
                          <a key={i} href={m.url} target="_blank" rel="noreferrer" title={m.name}>
                            <img src={m.url} alt={m.name} style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, marginRight: 4, border: '1px solid var(--border)' }} />
                          </a>
                        ) : (
                          <a key={i} href={m.url} target="_blank" rel="noreferrer" className="badge" style={{ marginRight: 4, textDecoration: 'none' }}>PDF</a>
                        )
                      )) : <span className="text-secondary">—</span>}
                      {r.hiddenMaterialCount > 0 && (
                        <span className="text-secondary" style={{ fontSize: 11 }}>（{r.hiddenMaterialCount} 份仅管理员可见）</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages(ledgerTotal, LEDGER_SIZE) > 1 && (
          <div className="flex" style={{ gap: 6, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" disabled={ledgerPage <= 1} onClick={() => changeLedgerPage(ledgerPage - 1)}>上一页</button>
            <span className="text-secondary" style={{ fontSize: 13, alignSelf: 'center' }}>
              第 {ledgerPage} / {totalPages(ledgerTotal, LEDGER_SIZE)} 页
            </span>
            <button className="btn btn-secondary btn-sm" disabled={ledgerPage >= totalPages(ledgerTotal, LEDGER_SIZE)} onClick={() => changeLedgerPage(ledgerPage + 1)}>下一页</button>
          </div>
        )}
      </div>

      <p className="text-secondary" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.8 }}>
        说明：公账为公会的真实资金账目（单位：元），与贡献点体系相互独立；捐赠时可由管理员按<b>每笔单独设定</b>的比例发放贡献点奖励。
        标记为「仅管理员可见」的凭证材料（如电子发票）不在本页公示，可在必要时向管理员申请查阅。
        {isAdmin && <> 你是管理员，可前往 <a href="/admin#donation">管理后台 · 捐赠墙</a> 维护账目。</>}
      </p>
    </div>
  );
}
