import { useEffect, useRef, useState, useCallback } from 'react';
import { api, getToken, getCurrentUser } from '../api';
import { ChatIcon, CollapseIcon, ImageIcon, SmileIcon, MicIcon } from './ChatIcons';

/**
 * 左下角公屏聊天窗（透明背景风格）
 *  - 纵向滚动、实时滚动到底部
 *  - 可收起（像皮肤窗格那样）
 *  - 仅公屏；私聊请到个人主页点「私聊」
 *  - 支持发送文本 / 表情包 / 图片 / 语音
 */
export default function ChatBox() {
  const [collapsed, setCollapsed] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [online, setOnline] = useState(0);
  const [status, setStatus] = useState('connecting');
  const [err, setErr] = useState('');
  const [myBubbles, setMyBubbles] = useState([]);
  const [bubbleId, setBubbleId] = useState(null);
  const [unread, setUnread] = useState(0);
  const [stickers, setStickers] = useState([]);
  const [showStickers, setShowStickers] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);

  const wsRef = useRef(null);
  const listRef = useRef(null);
  const collapsedRef = useRef(collapsed);
  const myIdRef = useRef(null);
  const mediaRef = useRef(null);      // MediaRecorder
  const chunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const recSecsRef = useRef(0);
  const recMimeRef = useRef('');
  const fileRef = useRef(null);

  useEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);
  const user = getCurrentUser();
  useEffect(() => { myIdRef.current = user?.id || null; }, [user]);

  const scrollBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(() => { if (!collapsed) setTimeout(scrollBottom, 30); }, [messages, collapsed]);

  // 连接 WS
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let closed = false;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      ws.send(JSON.stringify({ type: 'chat_history', channel: 'public' }));
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'connected') return;
      if (m.type === 'chat_error') { setErr(m.error || '发送失败'); setTimeout(() => setErr(''), 3000); return; }
      if (m.type === 'chat_history') {
        if (m.channel === 'public') setMessages(m.messages || []);
        return;
      }
      if (m.type === 'chat' && m.channel === 'public') {
        const mine = String(m.sender?.id) === String(myIdRef.current);
        setMessages(prev => [...prev, m].slice(-300));
        if (collapsedRef.current && !mine) setUnread(u => u + 1);
      }
    };
    ws.onclose = () => { if (!closed) setStatus('closed'); };
    ws.onerror = () => setStatus('closed');
    return () => { closed = true; try { ws.close(); } catch (e) {} };
  }, []);

  // 在线人数
  useEffect(() => {
    const f = () => api.get('/api/chat/online').then(d => setOnline(d.online || 0)).catch(() => {});
    f();
    const t = setInterval(f, 30000);
    return () => clearInterval(t);
  }, []);

  // 我的气泡
  const loadMyBubbles = useCallback(() => {
    api.get('/api/chat/bubbles/mine').then(d => {
      const list = d.bubbles || [];
      setMyBubbles(list);
      if (list.length && bubbleId == null) setBubbleId(list[0].id);
    }).catch(() => {});
  }, [bubbleId]);
  useEffect(() => { if (!collapsed) loadMyBubbles(); }, [collapsed, loadMyBubbles]);

  // 我的表情包
  const loadStickers = useCallback(() => {
    api.get('/api/chat/stickers/mine').then(d => setStickers(d.stickers || [])).catch(() => {});
  }, []);
  useEffect(() => { if (!collapsed) loadStickers(); }, [collapsed, loadStickers]);

  const sendRaw = (payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setErr('未连接'); return false; }
    ws.send(JSON.stringify(payload));
    return true;
  };

  const sendText = () => {
    const content = input.trim();
    if (!content) return;
    if (sendRaw({ type: 'chat', channel: 'public', content, bubbleId: bubbleId || undefined })) setInput('');
  };

  const sendSticker = (st) => {
    sendRaw({ type: 'chat', channel: 'public', stickerUrl: st.url, content: '[表情]', bubbleId: bubbleId || undefined });
    setShowStickers(false);
  };

  // 发送图片（公屏）
  const onPickImage = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setErr('图片不能超过 5MB');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getToken();
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '上传失败');
      sendRaw({ type: 'chat', channel: 'public', imageUrl: j.url, content: '[图片]', bubbleId: bubbleId || undefined });
    } catch (e2) { setErr(e2.message); }
  };

  // 录音（最长 60 秒）
  const pickRecMime = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    if (typeof MediaRecorder === 'undefined') return '';
    for (const t of candidates) { if (MediaRecorder.isTypeSupported(t)) return t; }
    return '';
  };
  const startRec = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickRecMime();
      recMimeRef.current = mime;
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRef.current = mr;
      chunksRef.current = [];
      recSecsRef.current = 0;
      mr.ondataavailable = (ev) => { if (ev.data.size > 0) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: recMimeRef.current || 'audio/webm' });
        if (blob.size > 0) await uploadVoice(blob, recSecsRef.current);
        setRecording(false); setRecSecs(0);
        if (recTimerRef.current) clearInterval(recTimerRef.current);
      };
      mr.start();
      setRecording(true); setRecSecs(0);
      recTimerRef.current = setInterval(() => {
        recSecsRef.current += 1;
        setRecSecs(recSecsRef.current);
        if (recSecsRef.current >= 60) { try { mr.stop(); } catch (e) {} }
      }, 1000);
    } catch (e) { setErr('无法访问麦克风'); }
  };

  const stopRec = () => { try { mediaRef.current && mediaRef.current.stop(); } catch (e) {} };

  const uploadVoice = async (blob, duration) => {
    try {
      const fd = new FormData();
      const mime = blob.type || 'audio/webm';
      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
      fd.append('file', blob, 'voice.' + ext);
      const token = getToken();
      const res = await fetch('/api/chat/upload?kind=voice', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '语音上传失败');
      sendRaw({ type: 'chat', channel: 'public', voiceUrl: j.url, duration: duration || 0, content: '[语音]', bubbleId: bubbleId || undefined });
    } catch (e) { setErr(e.message); }
  };

  // 上传表情包
  const onUploadSticker = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setErr('表情包不能超过 2MB');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getToken();
      const res = await fetch('/api/chat/stickers', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '上传失败');
      loadStickers();
    } catch (e2) { setErr(e2.message); }
  };

  const bubbleStyle = (bubble) => {
    if (!bubble) return {};
    return {
      background: bubble.bgColor,
      color: bubble.textColor,
      border: bubble.borderColor ? `1px solid ${bubble.borderColor}` : 'none',
    };
  };

  if (collapsed) {
    return (
      <button onClick={() => { setCollapsed(false); setUnread(0); }} style={collapsedBtn} title="打开聊天室">
        <ChatIcon size={22} color="#fff" />
        {unread > 0 && <span style={badge}>{unread > 99 ? '99+' : unread}</span>}
      </button>
    );
  }

  return (
    <div style={box}>
      <div style={header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ChatIcon size={15} color="#1a3d7c" />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#1a3d7c' }}>公屏</span>
          <span style={{ fontSize: 11, color: status === 'open' ? '#1e9e6a' : '#c0392b' }}>
            ● {status === 'open' ? '已连接' : status === 'connecting' ? '连接中' : '已断开'}
          </span>
          <span style={{ fontSize: 11, color: '#5b6b8c' }}>在线 {online}</span>
        </div>
        <button style={iconBtn} title="收起" onClick={() => setCollapsed(true)}><CollapseIcon size={16} color="#5b6b8c" /></button>
      </div>

      <div ref={listRef} style={list}>
        {messages.length === 0 && <p style={hint}>还没有消息，来说点什么吧～</p>}
        {messages.map((m) => {
          const mine = String(m.sender?.id) === String(myIdRef.current);
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.85)', textShadow: '0 1px 2px rgba(0,0,0,.4)', marginBottom: 2 }}>
                {m.sender?.nickname || m.sender?.username || '用户'}
              </span>
              <div style={{ ...bubbleBase, ...bubbleStyle(m.bubble), ...(mine && !m.bubble ? { background: 'rgba(26,115,232,.85)', color: '#fff' } : {}) }}>
                {m.imageUrl ? (
                  <img src={m.imageUrl} alt="" style={{ maxWidth: 160, borderRadius: 8, display: 'block' }} />
                ) : m.stickerUrl ? (
                  <img src={m.stickerUrl} alt="" style={{ maxWidth: 96, display: 'block' }} />
                ) : m.voiceUrl ? (
                  <audio controls src={m.voiceUrl} style={{ height: 32, maxWidth: 180 }} />
                ) : (
                  m.content
                )}
              </div>
            </div>
          );
        })}
      </div>

      {err && <div style={{ fontSize: 11, color: '#ffd0d0', padding: '0 10px 4px', textShadow: '0 1px 2px rgba(0,0,0,.5)' }}>{err}</div>}

      {showStickers && (
        <div style={stickerPanel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#5b6b8c' }}>我的表情包</span>
            <label style={miniBtn}>
              上传
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onUploadSticker} />
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
            {stickers.length === 0 && <span style={{ fontSize: 11, color: '#b0bdd4' }}>还没有表情包，点右上「上传」添加</span>}
            {stickers.map(st => (
              <img key={st.id} src={st.url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #e3ebf7' }} onClick={() => sendSticker(st)} />
            ))}
          </div>
        </div>
      )}

      <div style={bubbleBar}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.8)' }}>气泡</span>
        <button style={{ ...bubbleChip, background: 'rgba(255,255,255,.85)', color: '#5b6b8c', outline: bubbleId == null ? '2px solid #fff' : 'none' }} onClick={() => setBubbleId(null)}>无</button>
        {myBubbles.map(b => (
          <button key={b.id} style={{ ...bubbleChip, background: b.bgColor, color: b.textColor, border: b.borderColor ? `1px solid ${b.borderColor}` : 'none', outline: bubbleId === b.id ? '2px solid #fff' : 'none' }} onClick={() => setBubbleId(b.id)} title={b.name}>{b.name}</button>
        ))}
        {myBubbles.length === 0 && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.7)' }}>（去商城购买）</span>}
      </div>

      <div style={inputRow}>
        <button style={toolBtn} title="表情包" onClick={() => setShowStickers(s => !s)}><SmileIcon size={17} color="#cfe0ff" /></button>
        <button style={toolBtn} title="发送图片" onClick={() => fileRef.current && fileRef.current.click()}><ImageIcon size={17} color="#cfe0ff" /></button>
        <button
          style={{ ...toolBtn, background: recording ? 'rgba(220,60,60,.85)' : 'transparent' }}
          title={recording ? `录音中 ${recSecs}s（点击结束，最长60s）` : '按住录音（最长60秒）'}
          onClick={() => recording ? stopRec() : startRec()}
        ><MicIcon size={17} color={recording ? '#fff' : '#cfe0ff'} /></button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />
        <input
          style={inputStyle}
          value={input}
          placeholder={recording ? `录音中 ${recSecs}s…点击麦克风结束` : '说点什么…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
          maxLength={500}
        />
        <button style={sendBtn} onClick={sendText} disabled={status !== 'open'}>发送</button>
      </div>
    </div>
  );
}

// ---------- 透明背景样式 ----------
const GLASS = 'rgba(20,32,58,.42)';
const box = {
  position: 'fixed', left: 16, bottom: 16, width: 300, height: 400,
  background: GLASS,
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  borderRadius: 14, boxShadow: '0 10px 32px rgba(0,0,0,.28)',
  display: 'flex', flexDirection: 'column', zIndex: 60, overflow: 'hidden',
  border: '1px solid rgba(255,255,255,.22)',
};
const collapsedBtn = {
  position: 'fixed', left: 16, bottom: 16, width: 48, height: 48, borderRadius: '50%',
  background: 'rgba(26,115,232,.82)', backdropFilter: 'blur(6px)',
  color: '#fff', border: '1px solid rgba(255,255,255,.3)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 8px 20px rgba(0,0,0,.3)', zIndex: 60,
};
const badge = { position: 'absolute', top: -2, right: -2, background: '#e53935', color: '#fff', borderRadius: 999, fontSize: 10, padding: '1px 5px', fontWeight: 700 };
const header = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,.18)' };
const iconBtn = { background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px', display: 'flex', alignItems: 'center' };
const list = { flex: 1, overflowY: 'auto', padding: '10px 10px 4px' };
const hint = { fontSize: 12, color: 'rgba(255,255,255,.6)', textAlign: 'center', marginTop: 20 };
const bubbleBase = { maxWidth: '80%', padding: '6px 10px', borderRadius: 12, fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word', background: 'rgba(255,255,255,.9)', color: '#1a3d7c' };
const bubbleBar = { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderTop: '1px solid rgba(255,255,255,.12)', overflowX: 'auto' };
const bubbleChip = { fontSize: 11, borderRadius: 999, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap', border: 'none' };
const inputRow = { display: 'flex', gap: 4, padding: 8, borderTop: '1px solid rgba(255,255,255,.15)', alignItems: 'center' };
const inputStyle = { flex: 1, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.14)', color: '#fff', borderRadius: 10, padding: '6px 10px', fontSize: 13, outline: 'none', minWidth: 0 };
const sendBtn = { background: 'rgba(26,115,232,.9)', color: '#fff', border: 'none', borderRadius: 10, padding: '6px 12px', fontSize: 13, cursor: 'pointer' };
const toolBtn = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, display: 'flex', alignItems: 'center' };
const stickerPanel = { padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.95)' };
const miniBtn = { fontSize: 11, background: '#1a73e8', color: '#fff', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' };
