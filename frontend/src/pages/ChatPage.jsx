import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, getToken, getCurrentUser, wsUrlWithToken } from '../api';
import { SmileIcon, ImageIcon, MicIcon, SendIcon, UsersIcon } from '../components/ChatIcons';
import VoiceBubble from '../components/VoiceBubble';

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
  const [replyTo, setReplyTo] = useState(null);      // 正在回复的消息（引用）
  const [highlightId, setHighlightId] = useState(null); // 点击引用后短暂高亮原消息

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
      setReplyTo(null);
      // 打开会话即视为已读（WS 未连上时由 REST 兜底）
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat_read', channel: 'dm', with: targetId }));
      } else {
        api.post(`/api/chat/dm/${targetId}/read`, {})
          .then(() => loadConvs())   // 回执后刷新会话列表未读角标
          .catch(() => {});
      }
    } catch (e) { setErr(e.message); }
  }, [loadConvs]);

  useEffect(() => {
    if (userId) openWith(parseInt(userId));
  }, [userId, openWith]);

  // 上报当前会话已读（收到新消息 / 切回标签页时）
  const reportRead = useCallback(() => {
    const cur = peerRef.current;
    if (!cur || document.visibilityState === 'hidden') return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat_read', channel: 'dm', with: cur.id }));
    }
  }, []);

  useEffect(() => {
    const onVisible = () => reportRead();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [reportRead]);

  // WS 连接（用于实时收私聊）
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let closed = false;
    const ws = new WebSocket(wsUrlWithToken());
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus('open');
      // 连上后补报一次已读
      const cur = peerRef.current;
      if (cur) ws.send(JSON.stringify({ type: 'chat_read', channel: 'dm', with: cur.id }));
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'chat_error') { setErr(m.error || '发送失败'); setTimeout(() => setErr(''), 3000); return; }
      // 已读回执：把对应消息标记为已读（双方都会收到，便于多端同步）
      if (m.type === 'chat_read' && m.channel === 'dm') {
        const ids = new Set((m.messageIds || []).map(String));
        if (ids.size) {
          setMessages(prev => prev.map(x => ids.has(String(x.id)) ? { ...x, readAt: m.readAt } : x));
        }
        loadConvs();
        return;
      }
      if (m.type === 'chat' && m.channel === 'dm') {
        const cur = peerRef.current;
        const mineMsg = String(m.sender?.id) === String(myId);
        const other = mineMsg ? m.receiver?.id : m.sender?.id;
        if (cur && String(cur.id) === String(other)) {
          setMessages(prev => [...prev, m]);
          if (!mineMsg) reportRead();   // 正在看这个会话 → 立即回执已读
        }
        loadConvs();
      }
    };
    ws.onclose = () => { if (!closed) setStatus('closed'); };
    ws.onerror = () => setStatus('closed');
    return () => { closed = true; try { ws.close(); } catch (e) {} };
  }, [myId, loadConvs, reportRead]);

  const sendRaw = (payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setErr('未连接'); return false; }
    ws.send(JSON.stringify(payload));
    return true;
  };

  /** 统一的私聊发送：自动带上「回复引用」，并在发送成功后清空回复态 */
  const sendChat = (payload) => {
    if (!peer) return false;
    const ok = sendRaw({
      type: 'chat', channel: 'dm', to: peer.id,
      ...payload,
      replyTo: replyTo ? replyTo.id : undefined,
    });
    if (ok) setReplyTo(null);
    return ok;
  };

  const sendText = () => {
    const content = input.trim();
    if (!content || !peer) return;
    if (sendChat({ content })) setInput('');
  };

  const sendSticker = (url) => {
    if (!peer) return;
    sendChat({ stickerUrl: url, content: '[表情]' });
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
      sendChat({ imageUrl: j.url, content: '[图片]' });
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
      sendChat({ voiceUrl: j.url, duration: duration || 0, content: '[语音]' });
    } catch (e) { setErr(e.message); }
  };

  if (!getToken()) {
    return <div style={wrap}><div style={card}><p style={{ textAlign: 'center' }}>请先<Link to="/login">登录</Link>后使用私聊</p></div></div>;
  }

  return (
    <div style={page} className="dm-page">
      {/* 会话列表 */}
      <aside style={side} className="dm-side">
        <div style={sideHead}><UsersIcon size={15} color="var(--text)" /><span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>私聊</span></div>
        {convs.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '10px 12px' }}>还没有会话，去成员主页点「私聊」开始</p>}
        {convs.map(c => (
          <div key={c.userId} onClick={() => nav(`/chat/${c.userId}`)}
            style={{ ...convItem, background: peer && String(peer.id) === String(c.userId) ? 'var(--primary-light)' : 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nickname}</span>
              {c.unread > 0 && <span className="dm-unread-badge">{c.unread > 99 ? '99+' : c.unread}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
              {c.lastFromMe && <span style={{ flexShrink: 0, color: c.lastRead ? 'var(--success, #10b981)' : 'var(--text-secondary)' }}>{c.lastRead ? '已读' : '未读'}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.lastMessage}</span>
            </div>
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
              <div key={m.id} id={`dm-msg-${m.id}`}
                style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>{m.sender?.nickname}</span>
                <div className="dm-row">
                  {/* 回复按钮：桌面悬停出现，触摸端常显 */}
                  <button className="dm-reply-btn" title="回复该消息"
                    onClick={() => setReplyTo({ id: m.id, senderName: m.sender?.nickname || '用户', preview: m.imageUrl ? '[图片]' : m.stickerUrl ? '[表情]' : m.voiceUrl ? '[语音]' : String(m.content || '').slice(0, 60) })}>回复</button>
                  <div className={highlightId === m.id ? 'dm-bubble-flash' : ''}
                    style={{ ...bubble, ...(mine ? { background: 'var(--primary, #1a73e8)', color: '#fff' } : {}) }}>
                    {m.replyTo && (
                      <div className="dm-quote" title="点击定位原消息"
                        onClick={() => {
                          const el = document.getElementById(`dm-msg-${m.replyTo.id}`);
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          setHighlightId(m.replyTo.id);
                          setTimeout(() => setHighlightId(null), 1200);
                        }}>
                        <span className="dm-quote-name">{m.replyTo.senderName}</span>
                        <span className="dm-quote-text">{m.replyTo.preview}</span>
                      </div>
                    )}
                    {m.imageUrl ? (
                      <img src={m.imageUrl} alt="" style={{ maxWidth: 200, borderRadius: 8, display: 'block' }} />
                    ) : m.stickerUrl ? (
                      <img src={m.stickerUrl} alt="" style={{ maxWidth: 100, display: 'block' }} />
                    ) : m.voiceUrl ? (
                      <VoiceBubble url={m.voiceUrl} duration={m.voiceDuration} mine={mine} />
                    ) : m.content}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {m.imageUrl && m.expiresAt && <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>图片 3 天后过期</span>}
                  {mine && (
                    <span style={{ fontSize: 10, color: m.readAt ? 'var(--success, #10b981)' : 'var(--text-secondary)' }}>
                      {m.readAt ? '已读' : '未读'}
                    </span>
                  )}
                </div>
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

        {replyTo && (
          <div className="dm-reply-bar">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700 }}>回复 {replyTo.senderName}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replyTo.preview}</div>
            </div>
            <button className="dm-reply-cancel" title="取消回复" onClick={() => setReplyTo(null)}>×</button>
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
const page = { display: 'flex', gap: 12, height: 'calc(var(--app-vh, 1vh) * 100 - 220px)', minHeight: 360, background: 'var(--card)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-lg)' };
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
const inputStyle = { flex: 1, border: '1px solid var(--border)', background: 'var(--input-bg, var(--bg))', color: 'var(--text)', borderRadius: 10, padding: '6px 10px', fontSize: 16, outline: 'none', minWidth: 0 };
const sendBtn = { background: 'var(--primary, #1a73e8)', border: 'none', borderRadius: 10, padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' };
const toolBtn = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8, display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' };
