import { useEffect, useMemo, useState } from 'react';

/**
 * 从正文 HTML 里抽取 H1/H2/H3 生成目录。
 * 返回 [{ id, text, level }]，并在渲染时给标题补上 id（见 withHeadingIds）。
 */
export function extractToc(html = '') {
  const out = [];
  const re = /<h([123])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let m;
  let i = 0;
  while ((m = re.exec(html))) {
    const level = Number(m[1]);
    const text = m[3].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!text) continue;
    const idMatch = m[2].match(/id="([^"]+)"/);
    out.push({ id: idMatch ? idMatch[1] : `wiki-h-${i}`, text, level });
    i += 1;
  }
  return out;
}

/** 给正文里的 h1/h2/h3 按顺序补 id，保证 TOC 锚点能跳 */
export function withHeadingIds(html = '') {
  let i = 0;
  return String(html).replace(/<h([123])([^>]*)>/gi, (full, lv, attrs) => {
    if (/id="/.test(attrs)) return full;
    const id = `wiki-h-${i}`;
    i += 1;
    return `<h${lv}${attrs} id="${id}">`;
  });
}

/**
 * 文章目录：点击平滑滚动 + 当前章节高亮；移动端可折叠。
 */
export default function WikiToc({ html = '', title = '本页目录' }) {
  const items = useMemo(() => extractToc(html), [html]);
  const [activeId, setActiveId] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!items.length) return;
    const onScroll = () => {
      // 找到距离顶部最近、且已进入视口 120px 以内的标题
      let current = items[0].id;
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 130) current = it.id;
      }
      setActiveId(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [items]);

  if (!items.length) return null;

  const jump = (e, id) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: 'smooth' });
    setOpen(false);
  };

  return (
    <>
      <div className="wiki-panel wiki-toc-mobile" style={{ marginBottom: 12 }}>
        <h4 style={{ cursor: 'pointer', margin: 0 }} onClick={() => setOpen(o => !o)}>
          {title} {open ? '▲' : '▼'}
        </h4>
        {open && (
          <ul className="wiki-toc" style={{ marginTop: 10 }}>
            {items.map(it => (
              <li key={it.id} className={it.level === 3 ? 'lv3' : ''}>
                <a href={`#${it.id}`} className={activeId === it.id ? 'active' : ''} onClick={e => jump(e, it.id)}>{it.text}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="wiki-panel">
        <h4>{title}</h4>
        <ul className="wiki-toc">
          {items.map(it => (
            <li key={it.id} className={it.level === 3 ? 'lv3' : ''}>
              <a href={`#${it.id}`} className={activeId === it.id ? 'active' : ''} onClick={e => jump(e, it.id)}>{it.text}</a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
