import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/UI';
import { AlertIcon, UsersIcon, CardIcon, CheckCircleIcon } from '../components/ChatIcons';
import { fmtPoints, requireLogin, formatDate } from '../utils';
import { qrImageUrl, shareLink, copyText } from '../lib/pay';

const DEFAULT_DAYS = 7;

/** datetime-local 需要的 'YYYY-MM-DDTHH:mm'（本地时间） */
function toLocalInput(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function defaultDeadline() {
  return toLocalInput(new Date(Date.now() + DEFAULT_DAYS * 24 * 3600 * 1000));
}

/**
 * 开缴费单：/pay/charge-new
 * 与机器人 `#缴费单` 等价，但可以在官网「搜索成员逐个加入」名单：
 * 支持按昵称/用户名/QQ 号搜索已绑定成员、按姓名添加未绑定玩家、按人设定金额、开放缴纳。
 * 权限：管理员（level ≥ 1）或认证成员（email_verified），后端同样校验。
 */
export default function PayChargeNew() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [note, setNote] = useState('');
  const [payeeType, setPayeeType] = useState('event');
  const [openAll, setOpenAll] = useState(false);

  const [members, setMembers] = useState([]);      // [{id, name, username, qqBound, inRoster}]
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState([]);        // [{id, name, amount}]
  const [guestName, setGuestName] = useState('');
  const [guestAmount, setGuestAmount] = useState('');
  const [guests, setGuests] = useState([]);        // [{playerName, amount}]
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const canCreate = !!user && (user.level >= 1 || user.email_verified);

  useEffect(() => {
    if (!requireLogin(navigate, '开缴费单需要先登录')) return;
  }, [navigate]);

  // 搜索成员（防抖 350ms）
  useEffect(() => {
    const kw = q.trim();
    if (!kw) { setMembers([]); return undefined; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const d = await api.get(`/api/pay/members?q=${encodeURIComponent(kw)}`);
        setMembers(d.members || []);
      } catch (e) {
        showToast(e.message || '搜索成员失败', 'error');
        setMembers([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { clearTimeout(t); setSearching(false); };
  }, [q, showToast]);

  const addMember = useCallback((m) => {
    setPicked(prev => prev.some(x => x.id === m.id) ? prev : [...prev, { id: m.id, name: m.name, username: m.username, amount: '' }]);
    setQ('');
    setMembers([]);
  }, []);

  const removeMember = (id) => setPicked(prev => prev.filter(x => x.id !== id));

  const addGuest = () => {
    const name = guestName.trim();
    if (!name) return showToast('请填写玩家名称', 'error');
    if (guests.some(g => g.playerName === name)) return showToast('该玩家已在名单中', 'error');
    setGuests(prev => [...prev, { playerName: name, amount: guestAmount }]);
    setGuestName('');
    setGuestAmount('');
  };

  const totalPeople = picked.length + guests.length + (openAll ? 1 : 0);
  const estimate = useMemo(() => {
    const base = amount === '' ? null : Number(amount);
    const sum = [...picked, ...guests].reduce((s, x) => s + (x.amount === '' ? (base || 0) : Number(x.amount) || 0), 0);
    return base !== null && picked.length + guests.length > 0 ? sum : null;
  }, [amount, picked, guests]);

  const submit = async () => {
    if (!title.trim()) return showToast('请填写缴费单标题', 'error');
    if (amount === '' && picked.length === 0 && guests.length === 0 && !openAll) {
      return showToast('请填写统一金额，或至少加入一名成员 / 选择开放缴纳', 'error');
    }
    const targets = [
      ...picked.map(p => (p.amount === '' ? { userId: p.id } : { userId: p.id, amount: p.amount })),
      ...guests.map(g => (g.amount === '' ? { playerName: g.playerName } : { playerName: g.playerName, amount: g.amount }))
    ];
    setBusy(true);
    try {
      const d = await api.post('/api/pay/charge', {
        title: title.trim(),
        amount: amount === '' ? undefined : amount,
        deadline: deadline ? deadline.replace('T', ' ') + ':00' : undefined,
        note: note.trim(),
        payeeType,
        openAll,
        targets
      });
      setCreated(d);
      showToast(`缴费单已创建，名单 ${d.targetCount} 人`, 'success');
    } catch (e) {
      showToast(e.message || '创建缴费单失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  if (!canCreate) {
    return (
      <div className="fade-in-up">
        <div className="card" style={{ padding: 26, maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
          <AlertIcon size={44} />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: '10px 0 6px' }}>无法开缴费单</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            只有管理员或已完成邮箱认证的成员可以创建缴费单。你可以在群内让管理员用
            <code style={{ margin: '0 4px' }}>#缴费单</code>
            开单，或前往「我的收付款记录」查看自己的缴费单。
          </p>
          <div className="flex-center" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Link to="/pay/records" className="btn btn-primary">我的缴费单与记录</Link>
            <Link to="/pay" className="btn btn-secondary">支付中心</Link>
          </div>
        </div>
      </div>
    );
  }

  if (created) {
    const link = shareLink(`/pay/charge/${created.token}`);
    return (
      <div className="fade-in-up">
        <div className="card" style={{ padding: 24, maxWidth: 720, margin: '24px auto' }}>
          <div className="flex" style={{ gap: 10, alignItems: 'center', marginBottom: 14 }}>
            <CheckCircleIcon size={22} />
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>缴费单已创建</h2>
          </div>
          <div className="flex" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <img
              src={qrImageUrl(link)}
              alt="缴费单二维码"
              style={{ width: 200, height: 200, borderRadius: 12, background: '#fff', padding: 6 }}
            />
            <div style={{ flex: 1, minWidth: 240, fontSize: 14, lineHeight: 2 }}>
              <div>标题：<b>{created.title}</b></div>
              <div>金额：{created.amount === null || created.amount === undefined ? '各人金额不同 / 由缴纳人填写' : `${fmtPoints(created.amount)} 贡献点/人`}</div>
              <div>名单：{created.targetCount} 人</div>
              <div>截止：{formatDate(created.deadline)}</div>
              <div style={{ wordBreak: 'break-all', color: 'var(--text-secondary)', fontSize: 13 }}>{link}</div>
              <div className="flex" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={async () => showToast(await copyText(link) ? '链接已复制' : '复制失败，请手动选择', await copyText(link) ? 'success' : 'error')}>复制链接</button>
                <Link to={`/pay/charge/${created.token}`} className="btn btn-primary btn-sm">打开缴费单</Link>
                <Link to="/pay/records" className="btn btn-secondary btn-sm">我的缴费单</Link>
                <button className="btn btn-secondary btn-sm" onClick={() => { setCreated(null); setTitle(''); setPicked([]); setGuests([]); setNote(''); setAmount(''); setOpenAll(false); }}>再开一单</button>
              </div>
            </div>
          </div>
          <p className="text-secondary" style={{ fontSize: 12, marginTop: 14 }}>
            名单内的成员会收到站内通知；也可以随时在该缴费单页面继续「搜索成员逐个加入」。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in-up">
      <div className="page-banner" style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(/6.png?v=20260806)' }}>
        <div className="page-banner-content">
          <h1>开缴费单</h1>
          <p>一码多人，名单内成员各自缴纳自己的份额</p>
          <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Link to="/pay" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>返回支付中心</Link>
            <Link to="/pay/records" className="btn btn-ghost" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>我的缴费单</Link>
          </div>
        </div>
      </div>

      <div className="flex" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* 左：缴费单信息 */}
        <div className="card" style={{ padding: 22, flex: '1 1 380px', minWidth: 320 }}>
          <div className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <CardIcon size={20} />
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>缴费单信息</h3>
          </div>

          <div className="form-group">
            <label className="form-label">标题（必填）</label>
            <input className="form-input" value={title} maxLength={40} onChange={e => setTitle(e.target.value)} placeholder="例如：活动报名费" />
          </div>

          <div className="form-group">
            <label className="form-label">统一金额（可留空 = 按人填写）</label>
            <input className="form-input" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="例如：5.00" />
          </div>

          <div className="form-group">
            <label className="form-label">截止时间</label>
            <input className="form-input" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">用途说明（可选）</label>
            <input className="form-input" value={note} maxLength={100} onChange={e => setNote(e.target.value)} placeholder="例如：十一团建 AA" />
          </div>

          <div className="form-group">
            <label className="form-label">收款方</label>
            <div className="flex" style={{ gap: 14, flexWrap: 'wrap' }}>
              <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="radio" checked={payeeType === 'event'} onChange={() => setPayeeType('event')} />
                活动摊位（我自己收款）
              </label>
              <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="radio" checked={payeeType === 'system'} onChange={() => setPayeeType('system')} />
                公会金库「玄剑财政」
              </label>
            </div>
          </div>

          <label className="flex" style={{ gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={openAll} onChange={e => setOpenAll(e.target.checked)} />
            开放缴纳（不限名单，任何人都可以缴）
          </label>

          <div style={{ padding: '10px 12px', background: 'var(--input-bg)', borderRadius: 10, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
            当前名单 {totalPeople} 人{estimate !== null ? ` · 预计合计 ${fmtPoints(estimate)} 点` : ''}
            <br />
            单笔上限 500 点、单人日累计 2000 点、单笔超过 200 点需管理员审批；缴费后不可退款。
          </div>

          <button className="btn btn-primary" style={{ marginTop: 14, width: '100%' }} onClick={submit} disabled={busy}>
            {busy ? '创建中…' : '创建缴费单并生成二维码'}
          </button>
        </div>

        {/* 右：名单 */}
        <div className="card" style={{ padding: 22, flex: '1 1 380px', minWidth: 320 }}>
          <div className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <UsersIcon size={20} />
            <h3 style={{ fontSize: 17, fontWeight: 700 }}>名单（搜索成员逐个加入）</h3>
          </div>
          <p className="text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            支持按 昵称 / 用户名 / QQ 号 搜索已绑定成员；未绑定官网账号的玩家可直接按名称添加。
          </p>

          <div className="form-group">
            <input
              className="form-input"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="输入昵称 / 用户名 / QQ 号搜索，例如：蓦然"
            />
          </div>

          {searching && <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8 }}>搜索中…</div>}
          {!searching && q.trim() && members.length === 0 && (
            <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8 }}>没有匹配的成员</div>
          )}
          {members.length > 0 && (
            <div className="flex-col" style={{ gap: 6, marginBottom: 12, maxHeight: 220, overflowY: 'auto' }}>
              {members.map(m => {
                const already = picked.some(x => x.id === m.id) || m.inRoster;
                return (
                  <div key={m.id} className="flex-between" style={{ padding: '8px 10px', background: 'var(--input-bg)', borderRadius: 8, gap: 8 }}>
                    <span style={{ fontSize: 13, minWidth: 0, wordBreak: 'break-all' }}>
                      {m.name}
                      <span className="text-secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                        @{m.username}{m.qqBound ? ' · 已绑定 QQ' : ''}
                      </span>
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={already}
                      onClick={() => addMember(m)}
                    >
                      {already ? '已在名单' : '加入'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <h4 style={{ fontSize: 14, fontWeight: 700, margin: '6px 0 8px' }}>已加入（{picked.length + guests.length} 人）</h4>
          {picked.length === 0 && guests.length === 0 ? (
            <div className="empty-state" style={{ padding: 14 }}><p>还没有加入任何成员</p></div>
          ) : (
            <div className="flex-col" style={{ gap: 6, marginBottom: 12 }}>
              {picked.map(p => (
                <div key={`u-${p.id}`} className="flex-between" style={{ padding: '8px 10px', background: 'var(--input-bg)', borderRadius: 8, gap: 8 }}>
                  <span style={{ fontSize: 13, minWidth: 0, wordBreak: 'break-all' }}>{p.name}</span>
                  <span className="flex" style={{ gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      style={{ width: 92, padding: '4px 8px', fontSize: 12 }}
                      value={p.amount}
                      placeholder={amount === '' ? '金额' : String(amount)}
                      onChange={e => setPicked(prev => prev.map(x => x.id === p.id ? { ...x, amount: e.target.value } : x))}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => removeMember(p.id)}>移除</button>
                  </span>
                </div>
              ))}
              {guests.map(g => (
                <div key={`g-${g.playerName}`} className="flex-between" style={{ padding: '8px 10px', background: 'var(--input-bg)', borderRadius: 8, gap: 8 }}>
                  <span style={{ fontSize: 13, minWidth: 0, wordBreak: 'break-all' }}>
                    {g.playerName}
                    <span className="text-secondary" style={{ fontSize: 11, marginLeft: 6 }}>未绑定官网账号</span>
                  </span>
                  <span className="flex" style={{ gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.01"
                      style={{ width: 92, padding: '4px 8px', fontSize: 12 }}
                      value={g.amount}
                      placeholder={amount === '' ? '金额' : String(amount)}
                      onChange={e => setGuests(prev => prev.map(x => x.playerName === g.playerName ? { ...x, amount: e.target.value } : x))}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => setGuests(prev => prev.filter(x => x.playerName !== g.playerName))}>移除</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <h4 style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 8px' }}>添加未绑定玩家（按名称登记）</h4>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="form-input" style={{ flex: '1 1 140px' }} value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="玩家名称" />
            <input className="form-input" style={{ width: 110 }} type="number" min="0" step="0.01" value={guestAmount} onChange={e => setGuestAmount(e.target.value)} placeholder="金额" />
            <button className="btn btn-secondary" onClick={addGuest}>添加</button>
          </div>
        </div>
      </div>
    </div>
  );
}
