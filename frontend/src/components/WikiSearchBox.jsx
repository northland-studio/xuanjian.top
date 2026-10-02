import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

/**
 * Wiki 搜索框：输入实时下拉（防抖 250ms），回车进搜索页，Ctrl/⌘+K 聚焦。
 */
export default function WikiSearchBox({ autoFocus = false, placeholder = '搜索 Wiki：制度、历史、教程、API…' }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const seq = useRef(0);

  // Ctrl/⌘ + K 聚焦
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 点击外部收起
  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // 防抖搜索
  useEffect(() => {
    const kw = q.trim();
    if (!kw) { setItems([]); setOpen(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const d = await api.get(`/api/wiki/search?q=${encodeURIComponent(kw)}&limit=8`);
        if (my !== seq.current) return;
        setItems(d.pages || []);
        setActive(0);
        setOpen(true);
      } catch (e) {
        if (my === seq.current) setItems([]);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const go = (slug) => {
    setOpen(false);
    setQ('');
    navigate(`/wiki/${slug}`);
  };

  const submit = (e) => {
    e?.preventDefault();
    const kw = q.trim();
    if (!kw) return;
    if (open && items[active]) return go(items[active].slug);
    setOpen(false);
    navigate(`/wiki/search?q=${encodeURIComponent(kw)}`);
  };

  const onKeyDown = (e) => {
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <form className="wiki-search" onSubmit={submit} ref={boxRef}>
      <input
        ref={inputRef}
        value={q}
        autoFocus={autoFocus}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (items.length) setOpen(true); }}
        placeholder={placeholder}
        aria-label="搜索 Wiki"
      />
      <span className="wiki-search-hint">{loading ? '搜索中…' : 'Ctrl K'}</span>
      {open && items.length > 0 && (
        <div className="wiki-search-dropdown">
          {items.map((p, i) => (
            <a
              key={p.id}
              href={`/wiki/${p.slug}`}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={e => { e.preventDefault(); go(p.slug); }}
            >
              <div className="wd-title">{p.title}</div>
              <div className="wd-meta">
                {p.category_name ? `${p.category_name} · ` : ''}{p.snippet ? String(p.snippet).slice(0, 60) : (p.summary || '').slice(0, 60)}
              </div>
            </a>
          ))}
          <a href={`/wiki/search?q=${encodeURIComponent(q.trim())}`} onClick={e => { e.preventDefault(); submit(); }} style={{ color: 'var(--primary)' }}>
            <div className="wd-title">查看全部搜索结果 →</div>
          </a>
        </div>
      )}
    </form>
  );
}
