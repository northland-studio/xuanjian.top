import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { AlertIcon, CheckCircleIcon, CardIcon } from '../components/ChatIcons';
import { requireLogin, fmtPoints, formatDate } from '../utils';
import { qrImageUrl, shareLink, copyText, useCountdown, fmtSeconds } from '../lib/pay';
import { decodeImageFile, startScanner, hasCamera } from '../lib/qrScan';
const TABS = [
  { key: 'receive', label: '我的收款码' },
  { key: 'payer', label: '我的付款码' },
  { key: 'scan', label: '扫一扫' }
];

/**
 * 支付中心：/pay
 * 三个 Tab —— 我的收款码（主扫）/ 我的付款码（反扫）/ 扫一扫（三级降级）
 */
export default function Pay() {
  const navigate = useNavigate();
  const { user, refreshMe } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState('receive');

  // ---------- Tab1：我的收款码 ----------
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [receive, setReceive] = useState(null);
  const [rcLoading, setRcLoading] = useState(false);
  const rcLeft = useCountdown(receive ? receive.ttlSeconds : 0, receive ? receive.token : '');

  // ---------- Tab2：我的付款码 ----------
  const [payerCode, setPayerCode] = useState(null);
  const [payerErr, setPayerErr] = useState('');
  const [pending, setPending] = useState(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const payerLeft = useCountdown(payerCode ? payerCode.remainSeconds : 0, payerCode ? payerCode.token : '');

  // ---------- Tab3：扫一扫 ----------
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [askAmount, setAskAmount] = useState(null); // { code, amount, note }
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!requireLogin(navigate, '登录后可使用支付中心')) return undefined;
    refreshMe?.();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const stopScanner = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop();
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // 离开扫一扫 Tab 或卸载时释放摄像头
  useEffect(() => {
    if (tab !== 'scan') stopScanner();
    return () => stopScanner();
  }, [tab, stopScanner]);

  /* ============================ 我的收款码 ============================ */

  const createReceiveCode = async () => {
    if (rcLoading) return;
    setRcLoading(true);
    try {
      const body = { note: note.trim() };
      if (amount !== '' && amount !== null) body.amount = Number(amount);
      const d = await api.post('/api/pay/receive-code', body);
      setReceive(d);
      showToast('收款码已生成，90 秒内有效', 'success');
    } catch (e) {
      showToast(e.message || '生成收款码失败', 'error');
    } finally {
      setRcLoading(false);
    }
  };

  const copyLink = async (path) => {
    const ok = await copyText(shareLink(path));
    showToast(ok ? '链接已复制，可发给对方或群里' : '复制失败，请长按链接手动复制', ok ? 'success' : 'error');
  };

  /* ============================ 我的付款码 ============================ */

  const loadPayerCode = useCallback(async () => {
    try {
      const d = await api.get('/api/pay/payer-code/current');
      setPayerCode(d);
      setPayerErr('');
    } catch (e) {
      setPayerErr(e.message || '获取付款码失败');
    }
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const d = await api.get('/api/pay/payer-code/pending');
      setPending(d.pending || null);
    } catch {
      /* 轮询失败静默，下一轮重试 */
    }
  }, []);

  // 付款码：每 3 秒刷新一次（既续期二维码，也取待确认付款）
  useEffect(() => {
    if (!user || tab !== 'payer') return undefined;
    let on = true;
    const tick = async () => {
      await Promise.all([loadPayerCode(), loadPending()]);
    };
    tick();
    const t = setInterval(() => { if (on) tick(); }, 3000);
    return () => { on = false; clearInterval(t); };
  }, [user, tab, loadPayerCode, loadPending]);

  const confirmPending = async () => {
    if (!pending || pendingBusy) return;
    setPendingBusy(true);
    try {
      const r = await api.post(`/api/pay/intents/${pending.token}/confirm`, {});
      if (r.status === 'pending_approval') {
        showToast('金额较大，已提交管理员审批', 'info');
      } else {
        showToast(r.message || `已支付 ${fmtPoints(r.amount)} 贡献点`, 'success');
      }
      setPending(null);
      refreshMe?.();
      await Promise.all([loadPayerCode(), loadPending()]);
    } catch (e) {
      showToast(e.message || '支付失败', 'error');
    } finally {
      setPendingBusy(false);
    }
  };

  const rejectPending = async () => {
    if (!pending || pendingBusy) return;
    setPendingBusy(true);
    try {
      await api.post(`/api/pay/intents/${pending.token}/reject`, {});
      showToast('已取消该笔待确认付款', 'info');
      setPending(null);
      await Promise.all([loadPayerCode(), loadPending()]);
    } catch (e) {
      showToast(e.message || '取消失败', 'error');
    } finally {
      setPendingBusy(false);
    }
  };

  /* ============================== 扫一扫 ============================== */

  /** 统一处理识别到的码内容 */
  const handleCode = useCallback(async (code, extra) => {
    if (!code || !code.trim()) {
      showToast('没有识别到二维码内容', 'error');
      return;
    }
    setScanBusy(true);
    try {
      const body = { code: code.trim() };
      if (extra && extra.amount !== undefined && extra.amount !== '') body.amount = Number(extra.amount);
      if (extra && extra.note) body.note = extra.note;
      const r = await api.post('/api/pay/scan', body);
      stopScanner();
      setAskAmount(null);
      if (r.mode === 'payer_code') {
        setScanResult({ mode: 'payer_code', amount: r.amount, message: r.message, token: r.token });
        refreshMe?.();
      } else {
        // 收款码 / 缴费单码：直接进入落地页由本人确认
        const target = r.kind === 'charge' ? `/pay/charge/${r.token}` : `/pay/${r.token}`;
        navigate(target);
      }
    } catch (e) {
      // 扫到付款码但未带金额：后端要求补金额，就地弹出输入框（反扫第二步）
      if (e.status === 400 && /金额/.test(e.message || '')) {
        stopScanner();
        setAskAmount({ code: code.trim(), amount: '', note: '' });
      } else {
        showToast(e.message || '扫码失败', 'error');
      }
    } finally {
      setScanBusy(false);
    }
  }, [navigate, refreshMe, showToast, stopScanner]);

  const startCamera = async () => {
    setScanErr('');
    setScanResult(null);
    if (!hasCamera()) {
      setScanErr('当前浏览器不支持调用摄像头，请用「上传二维码图片」或「手动输入」');
      return;
    }
    setScanning(true);
    const scanner = await startScanner(
      videoRef.current,
      (text) => handleCode(text),
      (err) => {
        setScanning(false);
        setScanErr(`摄像头不可用（${err && err.name ? err.name : '未知原因'}），请改用上传图片或手动输入`);
      }
    );
    scannerRef.current = scanner;
  };

  const onPickImage = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    setScanErr('');
    setScanBusy(true);
    try {
      const text = await decodeImageFile(file);
      if (!text) {
        setScanErr('图片里没有识别到二维码，请换一张更清晰的截图');
        return;
      }
      await handleCode(text);
    } finally {
      setScanBusy(false);
    }
  };

  const points = user ? fmtPoints(user.contribution ?? 0) : '0.00';

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/2.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>支付中心</h1>
          <p>玄剑版「扫码支付」：出码收款、付款码被扫、扫一扫付款，全部用贡献点结算</p>
          <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Link to="/pay/records" className="btn btn-primary">我的收付款记录</Link>
            <Link to="/trade" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>直接转账</Link>
          </div>
        </div>
      </div>

      <div className="card mb-4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '16px 20px' }}>
        <span style={{ fontSize: 15 }}>我的贡献点余额</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning)' }}>
          {points} <span style={{ fontSize: 13, fontWeight: 400 }}>点</span>
        </span>
      </div>

      {/* 待确认付款：付款码被扫后的确认条 */}
      {pending && (
        <div className="card mb-4" style={{ borderLeft: '4px solid var(--warning)', padding: '16px 18px', background: 'var(--input-bg)' }}>
          <div className="flex" style={{ gap: 10, alignItems: 'flex-start' }}>
            <AlertIcon size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>有人扫了你的付款码请求收款</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                {pending.payeeName || '对方'} 请求收款
                <span style={{ color: 'var(--danger)', fontWeight: 700 }}> {fmtPoints(pending.amount)} </span>
                贡献点
                {pending.note ? `（${pending.note}）` : ''}
                <br />
                发起时间：{formatDate(pending.createdAt)}
              </div>
              <div className="flex" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" onClick={confirmPending} disabled={pendingBusy}>
                  {pendingBusy ? '处理中…' : `确认支付 ${fmtPoints(pending.amount)} 点`}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={rejectPending} disabled={pendingBusy}>取消</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex mb-3" style={{ gap: 8, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------------- 我的收款码 ---------------- */}
      {tab === 'receive' && (
        <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ padding: 22 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>生成收款码</h3>
            <p className="text-secondary" style={{ fontSize: 12, marginBottom: 16 }}>
              由你出示给付款方扫，二维码 90 秒内有效且只能支付一次。金额可留空，由付款方填写。
            </p>
            <div className="form-group">
              <label className="form-label">收款金额（可留空）</label>
              <input
                type="number"
                className="form-input"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="例如：12.50，留空则由付款方填写"
              />
            </div>
            <div className="form-group">
              <label className="form-label">用途备注（可选）</label>
              <input
                className="form-input"
                maxLength={100}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="例如：团建费用 / 材料费"
              />
            </div>
            <button className="btn btn-primary btn-block" onClick={createReceiveCode} disabled={rcLoading}>
              {rcLoading ? '生成中…' : receive ? '重新生成收款码' : '生成收款码'}
            </button>
            <div className="card" style={{ marginTop: 16, padding: 14, background: 'var(--input-bg)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>使用说明</h4>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
                1. 让付款方用官网「扫一扫」或手机相机扫码，打开落地页后由对方本人确认支付。<br />
                2. 也可以直接复制链接发给对方或发到群里。<br />
                3. 二维码过期或已被支付后需要重新生成，付款方无法重复支付。
              </div>
            </div>
          </div>

          <QrPanel
            title="我的收款码"
            token={receive ? receive.token : ''}
            link={receive ? shareLink(`/pay/${receive.token}`) : ''}
            left={rcLeft}
            ttl={receive ? receive.ttlSeconds : 90}
            amount={receive && receive.amount !== null ? receive.amount : null}
            payeeName={receive && receive.payee ? receive.payee.name : (user ? (user.nickname || user.username) : '')}
            note={receive ? note : ''}
            onCopy={() => receive && copyLink(`/pay/${receive.token}`)}
            onRegenerate={createReceiveCode}
            emptyText="点击左侧「生成收款码」，这里会显示二维码与倒计时"
          />
        </div>
      )}

      {/* ---------------- 我的付款码 ---------------- */}
      {tab === 'payer' && (
        <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ padding: 22 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>我的付款码</h3>
            <p className="text-secondary" style={{ fontSize: 12, marginBottom: 16 }}>
              由收款方扫你的付款码发起收款，你在本页确认后才真正扣款，60 秒自动刷新。
            </p>
            {payerErr && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{payerErr}</p>}
            <div className="card" style={{ padding: 14, background: 'var(--input-bg)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>安全提示</h4>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
                付款码只是「收款方发起收款」的凭据，<span style={{ fontWeight: 700 }}>不会自动扣款</span>；
                对方扫码并填写金额后，页面顶部会出现确认条，请核对收款方与金额再确认。
              </div>
            </div>
            {pending ? (
              <p style={{ marginTop: 14, fontSize: 13, color: 'var(--warning)', fontWeight: 600 }}>
                当前有一笔待确认付款，请在上方确认条中处理。
              </p>
            ) : (
              <p style={{ marginTop: 14, fontSize: 13, color: 'var(--text-secondary)' }}>当前没有待确认的收款请求，正在每 3 秒自动检查。</p>
            )}
          </div>

          <QrPanel
            title="我的付款码"
            token={payerCode ? payerCode.token : ''}
            link={payerCode ? shareLink(payerCode.url || `/pay/${payerCode.token}`) : ''}
            left={payerLeft}
            ttl={payerCode ? payerCode.ttlSeconds : 60}
            amount={null}
            payeeName={user ? (user.nickname || user.username) : ''}
            note="请收款方扫码"
            onCopy={() => payerCode && copyLink(payerCode.url || `/pay/${payerCode.token}`)}
            onRegenerate={loadPayerCode}
            emptyText="正在获取付款码…"
          />
        </div>
      )}

      {/* ---------------- 扫一扫 ---------------- */}
      {tab === 'scan' && (
        <div className="grid grid-2" style={{ gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ padding: 22 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>扫一扫</h3>
            <p className="text-secondary" style={{ fontSize: 12, marginBottom: 14 }}>
              扫描对方的收款码、缴费单码或付款码。摄像头不可用时可用上传图片或手动输入。
            </p>

            <div style={{ position: 'relative', background: '#000', borderRadius: 12, overflow: 'hidden', marginBottom: 12, aspectRatio: '4 / 3' }}>
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: scanning ? 'block' : 'none' }}
              />
              {!scanning && (
                <div className="flex-center" style={{ position: 'absolute', inset: 0, color: '#9fb0cc', fontSize: 13, textAlign: 'center', padding: 16 }}>
                  {scanErr ? '摄像头未开启' : '点击下方按钮开启摄像头扫码'}
                </div>
              )}
            </div>

            <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
              {!scanning ? (
                <button className="btn btn-primary" onClick={startCamera} disabled={scanBusy}>开启摄像头扫码</button>
              ) : (
                <button className="btn btn-secondary" onClick={stopScanner}>停止扫码</button>
              )}
              <button className="btn btn-secondary" onClick={() => fileRef.current && fileRef.current.click()} disabled={scanBusy}>
                上传二维码图片
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />

            {scanErr && (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--warning)', lineHeight: 1.8 }}>{scanErr}</p>
            )}
            {scanBusy && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}>正在处理…</p>}

            <div style={{ marginTop: 16, borderTop: '1px dashed var(--border)', paddingTop: 14 }}>
              <label className="form-label">手动输入码或链接</label>
              <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  style={{ flex: 1, minWidth: 180 }}
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value)}
                  placeholder="粘贴二维码内容或 https://xuanjian.top/pay/xxxx"
                />
                <button className="btn btn-primary" onClick={() => handleCode(manualCode)} disabled={scanBusy || !manualCode.trim()}>
                  提交
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 22 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>扫码结果</h3>
            {askAmount ? (
              <div>
                <div className="flex" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
                  <CardIcon size={22} />
                  <div style={{ fontSize: 14, fontWeight: 700 }}>这是付款码：请填写要向对方收取的金额</div>
                </div>
                <div className="form-group">
                  <label className="form-label">收款金额</label>
                  <input
                    type="number"
                    className="form-input"
                    min="0"
                    step="0.01"
                    value={askAmount.amount}
                    onChange={e => setAskAmount({ ...askAmount, amount: e.target.value })}
                    placeholder="例如：20.00"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">备注（可选）</label>
                  <input
                    className="form-input"
                    value={askAmount.note}
                    onChange={e => setAskAmount({ ...askAmount, note: e.target.value })}
                    placeholder="收款用途"
                  />
                </div>
                <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => handleCode(askAmount.code, askAmount)} disabled={scanBusy}>
                    {scanBusy ? '提交中…' : '向对方发起收款'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => setAskAmount(null)}>取消</button>
                </div>
              </div>
            ) : scanResult ? (
              <div>
                <div style={{ textAlign: 'center' }}><CheckCircleIcon size={44} /></div>
                <p style={{ textAlign: 'center', fontSize: 15, fontWeight: 700, marginTop: 8 }}>
                  已向对方发起收款请求
                </p>
                <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  {scanResult.message || '等待对方在自己的付款码页面确认'}
                  {scanResult.amount ? <><br />收款金额：{fmtPoints(scanResult.amount)} 贡献点</> : null}
                </p>
                <div className="flex-center" style={{ marginTop: 14 }}>
                  <button className="btn btn-secondary" onClick={() => { setScanResult(null); setManualCode(''); }}>再扫一次</button>
                </div>
              </div>
            ) : (
              <div className="empty-state" style={{ padding: 20 }}>
                <p>还没有扫码结果</p>
                <p className="text-secondary" style={{ fontSize: 12 }}>
                  扫到收款码或缴费单码会直接进入对应页面，扫到付款码则在此提示已发起收款。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 二维码展示块：图片 + 倒计时 + 复制链接（二维码由后端 /api/pay/qr.png 生成） */
function QrPanel({ title, token, link, left, ttl, amount, payeeName, note, onCopy, onRegenerate, emptyText }) {
  const [imgFailed, setImgFailed] = useState(false);
  const expired = !!token && left <= 0;

  useEffect(() => { setImgFailed(false); }, [token]);

  if (!token) {
    return (
      <div className="card" style={{ padding: 22 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>{title}</h3>
        <div className="empty-state" style={{ padding: 20 }}><p>{emptyText}</p></div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 22, textAlign: 'center' }}>
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{title}</h3>
      <p className="text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        {payeeName ? `收款方：${payeeName}` : '扫码即可付款'}
        {amount !== null && amount !== undefined ? ` · 金额 ${fmtPoints(amount)} 点` : ''}
        {note ? ` · ${note}` : ''}
      </p>

      <div style={{ position: 'relative', display: 'inline-block', background: '#fff', padding: 10, borderRadius: 12, boxShadow: 'var(--shadow)' }}>
        {!imgFailed ? (
          <img
            src={qrImageUrl(link)}
            alt={title}
            width={220}
            height={220}
            style={{ width: 220, height: 220, display: 'block', filter: expired ? 'grayscale(1) opacity(0.35)' : 'none' }}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5b6b8c', fontSize: 13, padding: 12 }}>
            二维码图片加载失败，请使用下方链接
          </div>
        )}
        {expired && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--danger)' }}>已过期</span>
            <button className="btn btn-primary btn-sm" onClick={onRegenerate}>重新生成</button>
          </div>
        )}
      </div>

      <p style={{ marginTop: 12, fontSize: 14, fontWeight: 700, color: expired ? 'var(--danger)' : 'var(--success)' }}>
        {expired ? '二维码已失效' : `剩余有效时间 ${fmtSeconds(left)} / ${ttl || 0} 秒`}
      </p>

      <div style={{ marginTop: 8, wordBreak: 'break-all', fontSize: 12, color: 'var(--text-secondary)' }}>{link}</div>
      <div className="flex-center" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCopy}>复制链接</button>
        {!expired && (
          <button className="btn btn-ghost btn-sm" onClick={onRegenerate}>重新生成</button>
        )}
      </div>
      <p className="text-secondary" style={{ fontSize: 12, marginTop: 10 }}>
        付款方扫码后在落地页核对金额，并由其本人确认支付。
      </p>
    </div>
  );
}
