import { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconBook, IconChevron } from './WikiIcons';

/**
 * Wiki 分类树（无限级）
 * @param {Array} nodes   getCategoryTree() 的返回（含 children）
 * @param {string} activeSlug 当前分类 slug（高亮）
 *
 * 移动端（≤780px）整棵树默认收起：面板标题变成一个 ≥44px 的「目录」按钮
 * （图标为内联 SVG，不用 emoji），否则手机上目录树会以「一整屏列表」的形式
 * 挡在正文前面/后面。
 * 桌面端按钮 display:none、标题 h4 原样显示，DOM 里多出来的按钮不参与布局，
 * 所以桌面三栏/两栏的排版与改动前逐像素一致。
 */
function TreeNode({ node, activeSlug }) {
  const active = activeSlug && node.slug === activeSlug;
  return (
    <li>
      <Link to={`/wiki/category/${node.slug}`} className={active ? 'active' : ''}>
        <span>{node.icon ? `${node.icon} ` : ''}{node.name}</span>
        {typeof node.page_count === 'number' && node.page_count > 0 && (
          <span className="wiki-count">{node.page_count}</span>
        )}
      </Link>
      {node.children && node.children.length > 0 && (
        <ul>
          {node.children.map(c => <TreeNode key={c.id} node={c} activeSlug={activeSlug} />)}
        </ul>
      )}
    </li>
  );
}

export default function WikiTree({ nodes = [], activeSlug = '', title = 'Wiki 目录' }) {
  const [open, setOpen] = useState(false);
  if (!nodes.length) return null;
  return (
    <div className={`wiki-panel wiki-tree-panel${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="wiki-panel-toggle wiki-tree-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="wiki-panel-toggle-label"><IconBook /> {title}</span>
        <span className="wiki-panel-chev" aria-hidden="true"><IconChevron /></span>
      </button>
      <h4 className="wiki-panel-title">{title}</h4>
      <ul className="wiki-tree">
        {nodes.map(n => <TreeNode key={n.id} node={n} activeSlug={activeSlug} />)}
      </ul>
    </div>
  );
}
