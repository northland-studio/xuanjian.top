import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, getToken, getCurrentUser } from '../api';
import { SmileIcon, ImageIcon, MicIcon, SendIcon, UsersIcon } from '../components/ChatIcons';

/**
 * 独立私聊页
 *  - 左侧会话列表（最近联系人），右侧消息区
 *  - 支持文本 / 图片(<2MB，3天过期) / 表情包 / 语音(≤60s)
 * 路由此页：/chat 和 /chat/:userId
 */
export default function ChatPage() {
  const { userId } = useParams();
  const nav = useNavigate();
  const my = getCurrentUser();
  const myId = my?.id;

  const [convs, setConvs] = useState([]);
  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('connecting');
  const [stickers, setStickers] = useState([]);
  const [publicStickers, setPublicStickers] = useState([]);
  const [showStickers, setShowStickers] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);

  const wsRef = useRef(null);
  const listRef = useRef(null);
  const peerRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const recSecsRef = useRef(0);
  const recMimeRef = useRef('');
  const imgRef = useRef(null);

  useEffect(() => { peerRef.current = peer; }, [peer]);

  const scrollBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(() => { setTimeout(scrollBottom, 30); }, [messages]);

  // 会话列表
  const loadConvs = useCallback(() => {
    api.get('/api/chat/dm/conversations').then(d => setConvs(d.conversations || [])).catch(() => {});
  }, []);
  useEffect(() => { loadConvs(); }, [loadConvs]);

  // 表情包
  useEffect(() => {
    api.get('/api/chat/stickers/mine').then(d => {
      setStickers(d.stickers || []);
      setPublicStickers(d.publicStickers || []);
    }).catch(() => {});
  }, []);

  // 打开与某人的会话
  const openWith = useCallback(async (targetId) => {
    try {
      const d = await api.get(`/api/chat/dm/${targetId}/messages`);
      setPeer(d.peer);
      setMessages(d.messages || []);
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => {
    if (userId) openWith(parseInt(userId));
  }, [userId, openWith]);

  // WS 连接（用于实时收私聊）
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let closed = false;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onopen = () => setStatus('open');
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'chat_error') { setErr(m.error || '发送失败'); setTimeout(() => setErr(''), 3000); return; }
      if (m.type === 'chat' && m.channel === 'dm') {
        const cur = peerRef.current;
        const other = String(m.sender?.id) === String(myId) ? m.receiver?.id : m.sender?.id;
        if (cur && String(cur.id) === String(other)) {
          setMessages(prev => [...prev, m]);
        }
        loadConvs();
      }
    };
    ws.onclose = () => { if (!closed) setStatus('closed'); };
    ws.onerror = () => setStatus('closed');
    return () => { closed = true; try { ws.close(); } catch (e) {} };
  }, [myId, loadConvs]);

  const sendRaw = (payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setErr('未连接'); return false; }
    ws.send(JSON.stringify(payload));
    return true;
  };

  const sendText = () => {
    const content = input.trim();
    if (!content || !peer) return;
    if (sendRaw({ type: 'chat', channel: 'dm', to: peer.id, content })) setInput('');
  };

  const sendSticker = (url) => {
    if (!peer) return;
    sendRaw({ type: 'chat', channel: 'dm', to: peer.id, stickerUrl: url, content: '[表情]' });
    setShowStickers(false);
  };

  // 私聊图片（< 2MB，3 天过期，后端落过期时间）
  const onPickImage = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !peer) return;
    if (file.size > 2 * 1024 * 1024) return setErr('私聊图片不能超过 2MB');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getToken();
      const res = await fetch('/api/chat/upload', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '上传失败');
      sendRaw({ type: 'chat', channel: 'dm', to: peer.id, imageUrl: j.url, content: '[图片]' });
    } catch (e2) { setErr(e2.message); }
  };

  // 语音（≤60s）
  const pickRecMime = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    if (typeof MediaRecorder === 'undefined') return '';
    for (const t of candidates) { if (MediaRecorder.isTypeSupported(t)) return t; }
    return '';
  };
  const startRec = async () => {
    if (recording || !peer) return;
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
      const res = await fetch('/api/chat/upload?kind=voice', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '语音上传失败');
      sendRaw({ type: 'chat', channel: 'dm', to: peer.id, voiceUrl: j.url, duration: duration || 0, content: '[语音]' });
    } catch (e) { setErr(e.message); }
  };

  if (!getToken()) {
    return <div style={wrap}><div style={card}><p style={{ textAlign: 'center' }}>请先<Link to="/login">登录</Link>后使用私聊</p></div></div>;
  }

  return (
    <div style={page}>
      {/* 会话列表 */}
      <aside style={side}>
        <div style={sideHead}><UsersIcon size={15} color="var(--text)" /><span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>私聊</span></div>
        {convs.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '10px 12px' }}>还没有会话，去成员主页点「私聊」开始</p>}
        {convs.map(c => (
          <div key={c.userId} onClick={() => nav(`/chat/${c.userId}`)}
            style={{ ...convItem, background: peer && String(peer.id) === String(c.userId) ? 'var(--primary-light)' : 'transparent' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{c.nickname}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.lastMessage}</div>
          </div>
        ))}
      </aside>

      {/* 消息区 */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={head}>
          {peer ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ color: 'var(--text)' }}>{peer.nickname}</b>
              <span style={{ fontSize: 11, color: status === 'open' ? '#1e9e6a' : '#c0392b' }}>● {status === 'open' ? '已连接' : status === 'connecting' ? '连接中' : '已断开'}</span>
            </div>
          ) : <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>选择左侧会话或从成员主页发起私聊</span>}
        </div>

        <div ref={listRef} style={list2}>
          {!peer && <p style={hint}>请选择一位成员开始私聊</p>}
          {peer && messages.length === 0 && <p style={hint}>还没有消息，打个招呼吧～</p>}
          {messages.map(m => {
            const mine = String(m.sender?.id) === String(myId);
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>{m.sender?.nickname}</span>
                <div style={{ ...bubble, ...(mine ? { background: 'var(--primary, #1a73e8)', color: '#fff' } : {}) }}>
                  {m.imageUrl ? (
                    <img src={m.imageUrl} alt="" style={{ maxWidth: 200, borderRadius: 8, display: 'block' }} />
                  ) : m.stickerUrl ? (
                    <img src={m.stickerUrl} alt="" style={{ maxWidth: 100, display: 'block' }} />
                  ) : m.voiceUrl ? (
                    <audio controls src={m.voiceUrl} style={{ height: 32, maxWidth: 200 }} />
                  ) : m.content}
                </div>
                {m.imageUrl && m.expiresAt && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>图片 3 天后过期</span>}
              </div>
            );
          })}
        </div>

        {err && <div style={{ fontSize: 11, color: '#c0392b', padding: '0 12px 4px' }}>{err}</div>}

        {showStickers && (
          <div style={stickerPanel}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>我的表情包</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
              {stickers.length === 0 && publicStickers.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>暂无表情包（可在公屏聊天窗上传，或等管理员添加公共表情）</span>}
              {stickers.map(st => <img key={'m' + st.id} src={st.url} alt="" style={stickerImg} onClick={() => sendSticker(st.url)} />)}
              {publicStickers.map(st => <img key={'p' + st.id} src={st.url} alt="" style={stickerImg} title={st.name} onClick={() => sendSticker(st.url)} />)}
            </div>
          </div>
        )}

        <div style={inputRow}>
          <button style={toolBtn} title="表情包" onClick={() => setShowStickers(s => !s)}><SmileIcon size={17} /></button>
          <button style={toolBtn} title="发送图片（<2MB）" onClick={() => imgRef.current && imgRef.current.click()}><ImageIcon size={17} /></button>
          <button style={{ ...toolBtn, background: recording ? '#fde8e8' : 'transparent' }}
            title={recording ? `录音中 ${recSecs}s（点击结束）` : '录音（最长60秒）'}
            onClick={() => recording ? stopRec() : startRec()}>
            <MicIcon size={17} color={recording ? '#c0392b' : 'currentColor'} />
          </button>
          <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickImage} />
          <input style={inputStyle} value={input} disabled={!peer}
            placeholder={recording ? `录音中 ${recSecs}s…` : (peer ? `发消息给 ${peer.nickname}` : '先选择会话')}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
            maxLength={500} />
          <button style={sendBtn} onClick={sendText} disabled={!peer || status !== 'open'}><SendIcon size={16} color="#fff" /></button>
        </div>
      </main>
    </div>
  );
}

const wrap = { minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const card = { background: 'var(--card)', borderRadius: 14, padding: 24, boxShadow: 'var(--shadow-lg)' };
const page = { display: 'flex', gap: 12, height: 'calc(100vh - 200px)', minHeight: 420, background: 'var(--card)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-lg)' };
const side = { width: 220, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 'none' };
const sideHead = { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--border)' };
const convItem = { padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' };
const head = { padding: '10px 14px', borderBottom: '1px solid var(--border)' };
const list2 = { flex: 1, overflowY: 'auto', padding: 12 };
const hint = { fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 20 };
const bubble = { maxWidth: '70%', padding: '6px 10px', borderRadius: 12, fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word', background: 'var(--bg)', color: 'var(--text)' };
const stickerPanel = { padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--bg)' };
const stickerImg = { width: 44, height: 44, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)' };
const inputRow = { display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--border)', alignItems: 'center' };
const inputStyle = { flex: 1, border: '1px solid var(--border)', background: 'var(--input-bg, var(--bg))', color: 'var(--text)', borderRadius: 10, padding: '6px 10px', fontSize: 13, outline: 'none', minWidth: 0 };
const sendBtn = { background: 'var(--primary, #1a73e8)', border: 'none', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' };
const toolBtn = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' };
