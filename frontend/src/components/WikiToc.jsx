import { useEffect, useMemo, useState } from 'react';
import { IconBook, IconChevron } from './WikiIcons';

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
 *
 * variant 决定渲染哪一份，默认 'both'（向后兼容）：
 *   - 'mobile' ：只渲染可折叠的移动版
 *   - 'desktop'：只渲染右栏的桌面面板
 *   - 'both'   ：两份都渲染（旧调用方行为不变）
 *
 * 移动版必须挂在**正文列内**：桌面右栏 `.wiki-col-toc` 在 ≤1080px 被整体隐藏，
 * 旧实现把移动折叠版放在同一个容器里，于是手机上永远没有目录可看。
 */
export default function WikiToc({ html = '', title = '本页目录', variant = 'both' }) {
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
    setActiveId(id);              // 立即高亮，滚动事件到达前也不闪
    // 不自动收起：手机上跳转后目录已滚出视口，保留展开态才能看到当前章节高亮
  };

  const list = (
    <ul className="wiki-toc">
      {items.map(it => (
        <li key={it.id} className={it.level === 3 ? 'lv3' : ''}>
          <a href={`#${it.id}`} className={activeId === it.id ? 'active' : ''} onClick={e => jump(e, it.id)}>{it.text}</a>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {variant !== 'desktop' && (
        <div className={`wiki-panel wiki-toc-mobile${open ? ' is-open' : ''}`}>
          <button
            type="button"
            className="wiki-toc-toggle"
            aria-expanded={open}
            onClick={() => setOpen(o => !o)}
          >
            <span className="wiki-panel-toggle-label"><IconBook /> {title}</span>
            <span className="wiki-panel-chev" aria-hidden="true"><IconChevron /></span>
          </button>
          {list}
        </div>
      )}
      {variant !== 'mobile' && (
        <div className="wiki-panel">
          <h4>{title}</h4>
          {list}
        </div>
      )}
    </>
  );
}
