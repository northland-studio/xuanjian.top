/**
 * 紫雪坊市（公会集市）内联 SVG 图标（替代 emoji 与 ★☆✓✕⚠ 等字形图标）。
 *
 * 写法严格对齐 WikiIcons.jsx / ChatIcons.jsx：
 * 24 视框、线性描边、stroke="currentColor"、strokeWidth 1.8、圆头圆角、
 * aria-hidden + focusable="false"，尺寸由 size 显式给定；在 flex 容器里
 * 统一用 style={{ flex: '0 0 auto' }} 防止被压缩，颜色继承当前字号颜色。
 *
 * 另外导出两个组合组件：
 * - <Stars value={4.3} size={14} />     5 颗评分星（0.5 粒度为半星）
 * - <StarToggle active={false} />       收藏态切换（实心 / 空心）
 * 评分与收藏统一用星形，保证同一页面内视觉一致。
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

/** 五角星路径（实心/空心/半星共用，与 WikiIcons 的精选星保持一致） */
const STAR_PATH = 'M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z';
/** 五角星的左半部分（用于半星填充） */
const STAR_HALF_PATH = 'M12 2.6V17.5L6.16 20.57 7.27 14.07 2.55 9.47 9.08 8.52Z';

/* ---------- 集市分类图标 ---------- */

/**
 * 分类图标按 **分类 slug** 由前端映射，不用数据库里的 icon 字段：
 * 数据库里的 icon 是内容（历史种子用过 emoji），由前端渲染 emoji 不符合本项目「图标一律 SVG」的约定，
 * 而 `<option>` 里也放不了 SVG 节点。管理员新建分类时不需要再填图标，选不出图标会回落到 IconTag。
 */
export function IconSword({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M14.5 3.5 20 3l-.5 5.5-8.6 8.6-4.4-4.4z" />
      <path d="m6.5 12.7-2.4 2.4 4.8 4.8 2.4-2.4" />
      <path d="m4.1 15.1-1 3.8 3.8-1" />
    </svg>
  );
}

export function IconBrick({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <rect x="3" y="5" width="18" height="5" rx="1" />
      <rect x="3" y="14" width="18" height="5" rx="1" />
      <path d="M9 5v5M15 5v5M6 14v5M12 14v5M18 14v5" />
    </svg>
  );
}

export function IconWheat({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M12 21V9" />
      <path d="M12 9c0-2 1.2-3.6 3-4.5.6 2.2-.2 4.2-3 4.5z" />
      <path d="M12 9c0-2-1.2-3.6-3-4.5-.6 2.2.2 4.2 3 4.5z" />
      <path d="M12 14c0-2 1.2-3.6 3-4.5.6 2.2-.2 4.2-3 4.5z" />
      <path d="M12 14c0-2-1.2-3.6-3-4.5-.6 2.2.2 4.2 3 4.5z" />
    </svg>
  );
}

export function IconTools({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M14.5 6.5a3.5 3.5 0 0 1 4.8-3.3l-2.6 2.6 1.6 1.6 2.6-2.6a3.5 3.5 0 0 1-4.6 4.6L6.8 19.1a1.7 1.7 0 1 1-2.4-2.4l9.7-9.7z" />
    </svg>
  );
}

export function IconTag({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M4 4h7.6L20 12.4 12.4 20 4 11.6z" />
      <circle cx="8.2" cy="8.2" r="1.4" />
    </svg>
  );
}

/** slug → 图标组件（seed 里的 5 个店铺分类 + 常见商品分类，其余回落 IconTag） */
const CATEGORY_ICONS = {
  general: IconStore,
  gear: IconSword,
  build: IconBrick,
  farm: IconWheat,
  service: IconTools,
  blocks: IconBrick,
  tools: IconSword,
  food: IconWheat,
  materials: IconPackage,
  drops: IconPackage,
  enchants: IconStarSolid,
  art: IconImage,
  other: IconTag
};

/** 分类图标（按 slug；找不到就用通用标签图标） */
export function CategoryIcon({ slug, size = 15 }) {
  const Cmp = CATEGORY_ICONS[String(slug || '').toLowerCase()] || IconTag;
  return <Cmp size={size} />;
}

/* ---------- 集市导航 / 入口 ---------- */

/** 商品 / 包裹（替代 📦 占位图） */
export function IconPackage({ size = 16 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

/** 地图 / 折叠地图（替代 🗺️） */
export function IconMap({ size = 16 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M9 3.5 3.5 5.5v15L9 18.5l6 2 5.5-2v-15L15 5.5z" />
      <path d="M9 3.5v15" />
      <path d="M15 5.5v15" />
    </svg>
  );
}

/** 单据 / 订单（替代 🧾） */
export function IconReceipt({ size = 16 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M6 3h12v18l-2-1.6-2 1.6-2-1.6-2 1.6-2-1.6-2 1.6z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

/** 店铺 / 门面（替代 🏪） */
export function IconStore({ size = 16 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M3 6.5 4.8 3.5h14.4L21 6.5l-3 2.7-3-2.7-3 2.7-3-2.7-3 2.7z" />
      <path d="M4.5 10.5V20h15v-9.5" />
      <path d="M9.5 20v-5.2h5V20" />
    </svg>
  );
}

/** 盾牌 + 对勾 / 管理后台（替代 🛡️） */
export function IconShield({ size = 16 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M12 3 5 5.8v5.6c0 4.2 2.9 7.5 7 8.9 4.1-1.4 7-4.7 7-8.9V5.8z" />
      <path d="m9.2 11.9 2.1 2.1 3.6-4.1" />
    </svg>
  );
}

/** 定位针 / 找店铺（替代 📍） */
export function IconPin({ size = 16 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M12 21.5s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" />
      <circle cx="12" cy="10.4" r="2.6" />
    </svg>
  );
}

/* ---------- 状态 / 操作 ---------- */

/** 对勾（替代 ✓） */
export function IconCheck({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={2.2} style={{ flex: '0 0 auto' }}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

/** 叉 / 关闭（替代 ✕ 与 ×，也用于弹窗右上角关闭按钮） */
export function IconClose({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={2.2} style={{ flex: '0 0 auto' }}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

/** 警告三角（替代 ⚠） */
export function IconWarn({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M10.3 4.3 2.9 17.2a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4" />
      <path d="M12 16.9h.01" />
    </svg>
  );
}

/** 返回箭头（替代 ← 字形） */
export function IconArrowLeft({ size = 14 }) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={2} style={{ flex: '0 0 auto' }}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}

/** 加号（替代全角 ＋） */
export function IconPlus({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={2.2} style={{ flex: '0 0 auto' }}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/** 减号（替代 − 字形） */
export function IconMinus({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} strokeWidth={2.2} style={{ flex: '0 0 auto' }}>
      <path d="M5 12h14" />
    </svg>
  );
}

/* ---------- 集市管理后台：地图设置 ---------- */

/** 图片 / 底图缩略（地图设置的底图占位与预览） */
export function IconImage({ size = 16 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m4.2 17.6 4.6-4.1a2 2 0 0 1 2.7.05l3.5 3.15 1.9-1.7a2 2 0 0 1 2.7.05l1.2 1.15" />
    </svg>
  );
}

/** 上传（地图设置里上传底图） */
export function IconUpload({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d="M12 16.5V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M4.5 16v2.6A1.4 1.4 0 0 0 5.9 20h12.2a1.4 1.4 0 0 0 1.4-1.4V16" />
    </svg>
  );
}

/* ---------- 评分 / 收藏 ---------- */

/** 实心星（评分与已收藏状态） */
export function IconStarSolid({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"
      style={{ flex: '0 0 auto' }}>
      <path d={STAR_PATH} />
    </svg>
  );
}

/** 空心星（未收藏状态） */
export function IconStarOutline({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d={STAR_PATH} />
    </svg>
  );
}

/** 半星（评分 0.5 粒度） */
export function IconStarHalf({ size = 15 }) {
  return (
    <svg {...BASE} width={size} height={size} style={{ flex: '0 0 auto' }}>
      <path d={STAR_HALF_PATH} fill="currentColor" stroke="none" />
      <path d={STAR_PATH} />
    </svg>
  );
}

/**
 * 5 颗星评分。value 按 0.5 粒度四舍五入（4.3 → 4 颗实心 + 1 颗半星）。
 * - size：单颗星像素
 * - showValue：是否跟随显示一位小数的数值
 * - count：评价条数（可选），countSuffix 为其单位文案（如 ' 条'）
 */
export function Stars({ value, count, size = 14, showValue = true, countSuffix = '', className = 'mk-stars' }) {
  const v = Number(value) || 0;
  const half = Math.round(v * 2) / 2;
  return (
    <span className={className} title={v > 0 ? `${v.toFixed(1)} 分` : '暂无评分'}>
      {[1, 2, 3, 4, 5].map(i => {
        if (i <= half) return <IconStarSolid key={i} size={size} />;
        if (i - 0.5 === half) return <IconStarHalf key={i} size={size} />;
        return <IconStarOutline key={i} size={size} />;
      })}
      {showValue && <span className="mk-stars-num">{v.toFixed(1)}</span>}
      {count !== undefined && count !== null && (
        <span className="text-secondary" style={{ fontWeight: 400 }}>（{count}{countSuffix}）</span>
      )}
    </span>
  );
}

/** 收藏态切换：实心星 = 已收藏，空心星 = 未收藏 */
export function StarToggle({ active, size = 15 }) {
  return active ? <IconStarSolid size={size} /> : <IconStarOutline size={size} />;
}
