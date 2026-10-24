/**
 * 玄剑姬悬浮问答窗（与公屏 ChatBox 完全独立）
 *
 * - 游客与登录用户都可用（服务端判定来源与限流）
 * - 显示真实来源链接，可跳转 /wiki/:slug
 * - 支持追问（会话由服务端签发）、新会话、关闭/重开
 * - 无 emoji；移动端自适应
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import '../styles/rag-widget.css';

const STORAGE_KEY = 'xuanjian_rag_conv';

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
            const r = await api('/api/faq/ask', {
                method: 'POST',
                body: { question, conversationId: convId || undefined }
            });
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
                    text: (r && r.answer) || '（没有返回内容）',
                    sources: (r && r.sources) || [],
                    abstained: !!(r && r.abstained),
                    requestId: r && r.requestId
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
            {!open && (
                <button className="rag-fab" type="button" onClick={() => setOpen(true)} aria-label="打开玄剑姬问答">
                    <span className="rag-fab-name">玄剑姬</span>
                    <span className="rag-fab-sub">Wiki 问答</span>
                </button>
            )}

            {open && (
                <section className="rag-panel" aria-label="玄剑姬问答">
                    <header className="rag-head">
                        <div className="rag-head-main">
                            <div className="rag-title">玄剑姬</div>
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
                                <p>可以问我公会制度、入会流程、贡献点规则、活动安排等。</p>
                                <p className="rag-empty-hint">回答都会标注 Wiki 来源；没有记载的问题我会直接说明。</p>
                            </div>
                        )}

                        {msgs.map((m, i) => (
                            <div key={i} className={`rag-msg rag-msg-${m.role}`}>
                                {m.role === 'assistant' && m.abstained && <div className="rag-badge">Wiki 暂无可靠记载</div>}
                                {m.role === 'error' && <div className="rag-badge rag-badge-bad">服务异常</div>}
                                <div className="rag-text">{m.text}</div>
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
                        ))}

                        {busy && (
                            <div className="rag-msg rag-msg-assistant">
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
                </section>
            )}
        </>
    );
}
