import { useEffect, useRef, useState, useCallback } from 'react';
import { api, getToken, getCurrentUser } from '../api';

/**
 * 左下角公屏聊天窗
 *  - 纵向滚动消息列表，实时滚动到底部
 *  - 可收起/展开（像皮肤窗格那样）
 *  - 支持公屏 / 私聊切换
 *  - 支持气泡颜色（购买后生效）
 */
export default function ChatBox() {
  const [collapsed, setCollapsed] = useState(true);   // 默认收起
  const [tab, setTab] = useState('public');          // public | dm
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [online, setOnline] = useState(0);
  const [status, setStatus] = useState('connecting'); // connecting | open | closed
  const [err, setErr] = useState('');
  const [myBubbles, setMyBubbles] = useState([]);
  const [bubbleId, setBubbleId] = useState(null);
  const [dmWith, setDmWith] = useState(null);        // { id, nickname }
  const [unread, setUnread] = useState(0);

  const wsRef = useRef(null);
  const listRef = useRef(null);
  const collapsedRef = useRef(collapsed);
  const tabRef = useRef(tab);
  const dmRef = useRef(dmWith);
  const myIdRef = useRef(null);

  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { dmRef.current = dmWith; }, [dmWith]);

  const user = getCurrentUser();
  useEffect(() => { myIdRef.current = user?.id || null; }, [user]);

  // 自动滚到底部
  const scrollBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(() => { if (!collapsed) setTimeout(scrollBottom, 30); }, [messages, collapsed, tab]);

  // 建立 WS 连接
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let closed = false;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      // 拉取公屏历史
      ws.send(JSON.stringify({ type: 'chat_history', channel: 'public' }));
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'connected') return;
      if (m.type === 'chat_error') { setErr(m.error || '发送失败'); setTimeout(() => setErr(''), 3000); return; }
      if (m.type === 'chat_history') {
        const msgs = m.messages || [];
        if (m.channel === 'dm') {
          // 仅在当前正在与该用户私聊时应用
          if (dmRef.current && String(dmRef.current.id) === String(m.with)) setMessages(msgs);
        } else {
          setMessages(msgs);
        }
        return;
      }
      if (m.type === 'chat') {
        const isDm = m.channel === 'dm';
        const mine = String(m.sender?.id) === String(myIdRef.current);
        if (isDm) {
          // 私聊：只在与对方会话中显示
          const other = mine ? m.receiver?.id : m.sender?.id;
          if (tabRef.current === 'dm' && dmRef.current && String(dmRef.current.id) === String(other)) {
            setMessages(prev => [...prev, m]);
          } else if (!mine) {
            // 收到他人私聊且未在该会话 → 记未读
            if (collapsedRef.current) setUnread(u => u + 1);
          }
        } else {
          // 公屏
          setMessages(prev => [...prev, m].slice(-300));
          if (collapsedRef.current && !mine) setUnread(u => u + 1);
        }
      }
    };
    ws.onclose = () => { if (!closed) setStatus('closed'); };
    ws.onerror = () => setStatus('closed');

    return () => { closed = true; try { ws.close(); } catch (e) {} };
  }, []);

  // 在线人数轮询
  useEffect(() => {
    const fetchOnline = () => api.get('/api/chat/online').then(d => setOnline(d.online || 0)).catch(() => {});
    fetchOnline();
    const t = setInterval(fetchOnline, 30000);
    return () => clearInterval(t);
  }, []);

  // 拉取我拥有的气泡
  const loadMyBubbles = useCallback(() => {
    api.get('/api/chat/bubbles/mine').then(d => {
      const list = d.bubbles || [];
      setMyBubbles(list);
      if (list.length && bubbleId == null) setBubbleId(list[0].id);
    }).catch(() => {});
  }, [bubbleId]);

  useEffect(() => { if (!collapsed) loadMyBubbles(); }, [collapsed, loadMyBubbles]);

  // 发送消息
  const send = () => {
    const content = input.trim();
    if (!content) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setErr('未连接，请稍候'); return; }
    const payload = { type: 'chat', channel: tab, content, bubbleId: bubbleId || undefined };
    if (tab === 'dm') {
      if (!dmWith) { setErr('请先选择私聊对象'); return; }
      payload.to = dmWith.id;
    }
    ws.send(JSON.stringify(payload));
    setInput('');
  };

  // 切换私聊对象
  const openDm = (target) => {
    setDmWith(target);
    setTab('dm');
    setMessages([]);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat_history', channel: 'dm', with: target.id }));
    }
    setCollapsed(false);
    setUnread(0);
  };

  // 点击公屏消息中的用户名 → 私聊
  const clickUser = (sender) => {
    if (!sender || String(sender.id) === String(myIdRef.current)) return;
    openDm({ id: sender.id, nickname: sender.nickname || sender.username || '用户' });
  };

  const bubbleStyle = (bubble) => {
    if (!bubble) return {};
    return {
      background: bubble.bgColor,
      color: bubble.textColor,
      border: bubble.borderColor ? `1px solid ${bubble.borderColor}` : 'none',
    };
  };

  // 收起状态：小圆钮
  if (collapsed) {
    return (
      <button
        onClick={() => { setCollapsed(false); setUnread(0); }}
        style={collapsedBtn}
        title="打开聊天室"
      >
        💬
        {unread > 0 && <span style={badge}>{unread > 99 ? '99+' : unread}</span>}
      </button>
    );
  }

  return (
    <div style={box}>
      {/* 头部 */}
      <div style={header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1a3d7c' }}>聊天室</span>
          <span style={{ fontSize: 11, color: status === 'open' ? '#1e9e6a' : '#c0392b' }}>
            ● {status === 'open' ? '已连接' : status === 'connecting' ? '连接中' : '已断开'}
          </span>
          <span style={{ fontSize: 11, color: '#8697b5' }}>在线 {online}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={iconBtn} title="收起" onClick={() => setCollapsed(true)}>—</button>
        </div>
      </div>

      {/* 标签：公屏 / 私聊 */}
      <div style={tabs}>
        <button style={tab === 'public' ? tabOn : tabOff} onClick={() => { setTab('public'); setMessages([]); const ws = wsRef.current; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'chat_history', channel: 'public' })); }}>公屏</button>
        <button style={tab === 'dm' ? tabOn : tabOff} onClick={() => setTab('dm')}>
          私聊{dmWith ? `：${dmWith.nickname}` : ''}
        </button>
      </div>

      {/* 消息列表（纵向滚动） */}
      <div ref={listRef} style={list}>
        {tab === 'dm' && !dmWith && (
          <p style={hint}>点击公屏里某人的昵称，即可发起私聊</p>
        )}
        {messages.length === 0 && tab === 'public' && (
          <p style={hint}>还没有消息，来说点什么吧～</p>
        )}
        {messages.map((m) => {
          const mine = String(m.sender?.id) === String(myIdRef.current);
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <span
                onClick={() => clickUser(m.sender)}
                style={{ fontSize: 11, color: '#8697b5', marginBottom: 2, cursor: 'pointer' }}
                title={mine ? '' : '点击私聊'}
              >
                {m.sender?.nickname || m.sender?.username || '用户'}
                {tab === 'dm' && m.receiver ? ` → ${m.receiver.nickname}` : ''}
              </span>
              <div
                style={{
                  ...bubbleBase,
                  ...bubbleStyle(m.bubble),
                  ...(mine ? { background: m.bubble ? m.bubble.bgColor : '#1a73e8', color: m.bubble ? m.bubble.textColor : '#fff' } : {}),
                }}
              >
                {m.content}
              </div>
            </div>
          );
        })}
      </div>

      {err && <div style={{ fontSize: 11, color: '#c0392b', padding: '0 10px 4px' }}>{err}</div>}

      {/* 气泡选择 */}
      <div style={bubbleBar}>
        <span style={{ fontSize: 11, color: '#8697b5' }}>气泡</span>
        <button
          style={{ ...bubbleChip, background: '#f0f4fb', color: '#5b6b8c', outline: bubbleId == null ? '2px solid #1a73e8' : 'none' }}
          onClick={() => setBubbleId(null)}
          title="不使用气泡"
        >无</button>
        {myBubbles.map(b => (
          <button
            key={b.id}
            style={{ ...bubbleChip, background: b.bgColor, color: b.textColor, border: b.borderColor ? `1px solid ${b.borderColor}` : 'none', outline: bubbleId === b.id ? '2px solid #1a73e8' : 'none' }}
            onClick={() => setBubbleId(b.id)}
            title={b.name}
          >{b.name}</button>
        ))}
        {myBubbles.length === 0 && <span style={{ fontSize: 11, color: '#b0bdd4' }}>（去商城购买气泡）</span>}
      </div>

      {/* 输入区 */}
      <div style={inputRow}>
        <input
          style={inputStyle}
          value={input}
          placeholder={tab === 'dm' ? (dmWith ? `私聊 ${dmWith.nickname}` : '先选择私聊对象') : '说点什么…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          maxLength={500}
        />
        <button style={sendBtn} onClick={send} disabled={status !== 'open'}>发送</button>
      </div>
    </div>
  );
}

// ---------- 样式 ----------
const box = {
  position: 'fixed', left: 16, bottom: 16, width: 300, height: 400,
  background: '#fff', borderRadius: 14, boxShadow: '0 10px 32px rgba(31,80,180,.18)',
  display: 'flex', flexDirection: 'column', zIndex: 60, overflow: 'hidden',
  border: '1px solid #e3ebf7',
};
const collapsedBtn = {
  position: 'fixed', left: 16, bottom: 16, width: 48, height: 48, borderRadius: '50%',
  background: '#1a73e8', color: '#fff', border: 'none', fontSize: 20, cursor: 'pointer',
  boxShadow: '0 8px 20px rgba(26,115,232,.35)', zIndex: 60,
};
const badge = {
  position: 'absolute', top: -2, right: -2, background: '#e53935', color: '#fff',
  borderRadius: 999, fontSize: 10, padding: '1px 5px', fontWeight: 700,
};
const header = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 10px', background: '#f4f8ff', borderBottom: '1px solid #e3ebf7',
};
const iconBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer', color: '#5b6b8c',
  fontSize: 16, lineHeight: 1, padding: '2px 6px',
};
const tabs = { display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid #eef2f9' };
const tabOn = { background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 999, padding: '3px 12px', fontSize: 12, cursor: 'pointer' };
const tabOff = { background: '#eef2f9', color: '#5b6b8c', border: 'none', borderRadius: 999, padding: '3px 12px', fontSize: 12, cursor: 'pointer' };
const list = { flex: 1, overflowY: 'auto', padding: '10px 10px 4px' };
const hint = { fontSize: 12, color: '#b0bdd4', textAlign: 'center', marginTop: 20 };
const bubbleBase = {
  maxWidth: '80%', padding: '6px 10px', borderRadius: 12, fontSize: 13,
  lineHeight: 1.5, wordBreak: 'break-word', background: '#eef2f9', color: '#1a3d7c',
};
const bubbleBar = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
  borderTop: '1px solid #eef2f9', overflowX: 'auto',
};
const bubbleChip = { fontSize: 11, borderRadius: 999, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap', border: 'none' };
const inputRow = { display: 'flex', gap: 6, padding: 10, borderTop: '1px solid #eef2f9' };
const inputStyle = {
  flex: 1, border: '1px solid #dbe7fb', borderRadius: 10, padding: '6px 10px',
  fontSize: 13, outline: 'none', minWidth: 0,
};
const sendBtn = {
  background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 10,
  padding: '6px 14px', fontSize: 13, cursor: 'pointer',
};
