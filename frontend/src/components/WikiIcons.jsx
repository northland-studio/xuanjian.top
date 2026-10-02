/**
 * Wiki 通用内联 SVG 图标（替代 emoji）。
 *
 * 风格统一对齐 ChatIcons.jsx / WikiRichEditor.jsx 的写法：
 * 24 视框、线性描边、stroke="currentColor"、aria-hidden。
 * 所有图标都继承字号颜色，尺寸由 width/height 显式给定，因此在
 * flex 容器里用 style={{ flex: '0 0 auto' }} 防止被压缩。
 */

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

/** 书本 / 目录 */
export function IconBook({ size = 16 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.6 1.6 0 0 0-1.6-1.6H4z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.6 1.6 0 0 1 1.6-1.6H20z" />
    </svg>
  );
}

/** 折叠箭头（展开态由 CSS 旋转 180°，见 wiki.css .is-open .wiki-panel-chev svg） */
export function IconChevron({ size = 14 }) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={2} style={{ flex: '0 0 auto' }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** 任务清单（方框 + 对勾） */
export function IconTask({ size = 17 }) {
  return (
    <svg {...BASE} width={size} height={size}>
      <rect x="3" y="4" width="16" height="16" rx="3" />
      <path d="m7.5 12 3 3 6-6.5" />
    </svg>
  );
}

/** 引用（双引号） */
export function IconQuote({ size = 17 }) {
  return (
    <svg {...BASE} width={size} height={size}>
      <path d="M9.5 6C7 7 5.5 9 5.5 11.6V18h5.2v-6.2H8.4c0-1.5.6-2.5 2-3.2z" />
      <path d="M18.5 6C16 7 14.5 9 14.5 11.6V18h5.2v-6.2h-2.3c0-1.5.6-2.5 2-3.2z" />
    </svg>
  );
}
