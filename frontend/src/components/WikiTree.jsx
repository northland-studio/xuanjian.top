import { Link } from 'react-router-dom';

/**
 * Wiki 分类树（无限级）
 * @param {Array} nodes   getCategoryTree() 的返回（含 children）
 * @param {string} activeSlug 当前分类 slug（高亮）
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
  if (!nodes.length) return null;
  return (
    <div className="wiki-panel">
      <h4>{title}</h4>
      <ul className="wiki-tree">
        {nodes.map(n => <TreeNode key={n.id} node={n} activeSlug={activeSlug} />)}
      </ul>
    </div>
  );
}
