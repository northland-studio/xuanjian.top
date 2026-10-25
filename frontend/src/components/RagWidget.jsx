/**
 * 玄剑姬 · 右侧抽屉式问答窗（与公屏 ChatBox 完全独立）
 *
 * - 悬浮按钮固定在屏幕右缘垂直居中，不再压住右下角的皮肤预览器
 * - 点击后从右侧滑出抽屉，遮罩可点击关闭
 * - 头像指向 CDN：https://cdn.xuanjian.top/xjj.png
 * - 回答用轻量 Markdown 渲染（React 元素输出，安全）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import RagMarkdown from './RagMarkdown';
import '../styles/rag-widget.css';

const STORAGE_KEY = 'xuanjian_rag_conv';
const AVATAR = 'https://cdn.xuanjian.top/xjj.png';

/** 头像：渐变底 + 「姬」字，CDN 图片作为背景叠加（404 自动回落到渐变，不出破图） */
function XjjAvatar({ className }) {
    return (
        <span className={`${className} rag-avatar-fallback`} style={{ backgroundImage: `url("${AVATAR}")` }} aria-hidden="true">
</span>
    );
}

export default function RagWidget() {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [msgs, setMsgs] = useState([]);
    const [convId, setConvId] = useState(null);
    const bodyRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        try {
            setConvId(localStorage.getItem(STORAGE_KEY));
        } catch {
            /* 隐私模式忽略 */
        }
    }, []);

    useEffect(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [msgs, busy]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        setTimeout(() => inputRef.current && inputRef.current.focus(), 260);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const newConversation = useCallback(() => {
        setMsgs([]);
        setConvId(null);
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* ignore */
        }
        if (inputRef.current) inputRef.current.focus();
    }, []);

    const send = useCallback(async () => {
        const question = input.trim();
        if (!question || busy) return;
        setInput('');
        setMsgs((m) => [...m, { role: 'user', text: question }]);
        setBusy(true);
        try {
            const r = await api.post('/api/faq/ask', { question, conversationId: convId || undefined });
            if (r && r.conversationId) {
                setConvId(r.conversationId);
                try {
                    localStorage.setItem(STORAGE_KEY, r.conversationId);
                } catch {
                    /* ignore */
                }
            }
            setMsgs((m) => [
                ...m,
                {
                    role: 'assistant',
                    text: (r && r.answer) || '（本剑这次没憋出话，再问一次试试）',
                    sources: (r && r.sources) || [],
                    abstained: !!(r && r.abstained)
                }
            ]);
        } catch (e) {
            setMsgs((m) => [...m, { role: 'error', text: e.message || '玄剑姬暂时不可用，请稍后再试' }]);
        } finally {
            setBusy(false);
            setTimeout(() => {
                if (inputRef.current) inputRef.current.focus();
            }, 30);
        }
    }, [input, busy, convId]);

    return (
        <>
            <button className={`rag-fab ${open ? 'is-hidden' : ''}`} type="button" onClick={() => setOpen(true)} aria-label="打开玄剑姬问答">
                <XjjAvatar className="rag-fab-avatar" />
                <span className="rag-fab-text">玄剑姬</span>
            </button>

            <div className={`rag-scrim ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />

            <aside className={`rag-drawer ${open ? 'is-open' : ''}`} aria-label="玄剑姬问答" aria-hidden={!open}>
                <header className="rag-head">
                    <XjjAvatar className="rag-avatar" />
                    <div className="rag-head-main">
                        <div className="rag-title">
                            玄剑姬
                            <span className="rag-title-tag">藏剑阁</span>
                        </div>
                        <div className="rag-sub">只依据公会 Wiki 已发布内容回答</div>
                    </div>
                    <div className="rag-head-actions">
                        <button className="rag-icon-btn" type="button" onClick={newConversation} title="开始新会话">
                            新会话
                        </button>
                        <button className="rag-icon-btn" type="button" onClick={() => setOpen(false)} title="收起">
                            收起
                        </button>
                    </div>
                </header>

                <div className="rag-body" ref={bodyRef}>
                    {msgs.length === 0 && (
                        <div className="rag-empty">
                            <p className="rag-empty-hello">本剑在此。公会的事，问我就行。</p>
                            <p>可以问制度、入会流程、贡献点规则、活动安排之类；答不出来时我会直说不装懂。</p>
                            <p className="rag-empty-hint">回答都会标注 Wiki 来源；没有记载的问题我会明说。</p>
                        </div>
                    )}

                    {msgs.map((m, i) => (
                        <div key={i} className={`rag-msg rag-msg-${m.role}`}>
                            {m.role !== 'user' && <XjjAvatar className="rag-msg-avatar" />}
                            <div className="rag-msg-main">
                                {m.role === 'assistant' && m.abstained && <div className="rag-badge">Wiki 暂无可靠记载</div>}
                                {m.role === 'assistant' && m.degraded && <div className="rag-badge">当前仅用全文检索（向量服务不可用）</div>}
                                {m.role === 'error' && <div className="rag-badge rag-badge-bad">服务异常</div>}
                                {m.role === 'assistant' ? <RagMarkdown text={m.text} /> : <div className="rag-text">{m.text}</div>}
                                {!!(m.sources && m.sources.length) && (
                                    <div className="rag-sources">
                                        <div className="rag-sources-title">来源</div>
                                        {m.sources.map((s, k) => (
                                            <a key={s.pageId || k} className="rag-source" href={s.url} target="_blank" rel="noreferrer">
                                                <span className="rag-source-idx">[{k + 1}]</span>
                                                <span className="rag-source-title">{s.title}</span>
                                                {s.categoryPath && <span className="rag-source-cat">{s.categoryPath}</span>}
                                            </a>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}

                    {busy && (
                        <div className="rag-msg rag-msg-assistant">
                            <XjjAvatar className="rag-msg-avatar" />
                            <div className="rag-typing">
                                <i />
                                <i />
                                <i />
                            </div>
                        </div>
                    )}
                </div>

                <form
                    className="rag-input-row"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void send();
                    }}
                >
                    <input
                        ref={inputRef}
                        className="rag-input"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="问点什么…（回车发送）"
                        maxLength={500}
                        disabled={busy}
                    />
                    <button className="rag-send" type="submit" disabled={busy || !input.trim()}>
                        发送
                    </button>
                </form>
            </aside>
        </>
    );
}
