/**
 * 前端权限工具（仅用于**体验**：菜单/按钮显示与路由门控）
 *
 * 重要：前端隐藏不等于安全。所有权限的真实边界都在后端
 * （middleware/auth.js + lib/permissions/*，每次请求实时计算）。
 */
import { useAuth } from '../../context/AuthContext';

/** 用户是否拥有某个权限（/api/auth/me 返回的 permissions 快照） */
export function hasPermission(user, key) {
  if (!user || !Array.isArray(user.permissions)) return false;
  return user.permissions.includes(key);
}

export function hasAnyPermission(user, keys) {
  if (!user || !Array.isArray(keys)) return false;
  return keys.some(k => hasPermission(user, k));
}

export function hasAllPermissions(user, keys) {
  if (!user || !Array.isArray(keys)) return false;
  return keys.every(k => hasPermission(user, k));
}

/** 权限管理员（Level 2 或持有 admin.permissions.manage） */
export function isPermissionAdmin(user) {
  if (!user) return false;
  return Number(user.level) >= 2 || user.is_permission_admin === true;
}

/** 是否可以进入 /admin（Level 1 基础权限 或 权限管理员） */
export function canEnterAdmin(user) {
  if (!user) return false;
  return Number(user.level) >= 1 || isPermissionAdmin(user);
}

/** 是否具备贡献点经济资格（后端 economy.contribution_points.access 的展示镜像） */
export function isEconomyMember(user) {
  return !!user && !!user.economy && user.economy.access === true;
}

/** 需要贡献点经济资格的导航入口（无资格时前端隐藏；后端同样会拒绝） */
export const ECONOMY_NAV_PATHS = [
  '/pay',
  '/pay/records',
  '/trade',
  '/claims',
  '/shop',
  '/inventory',
  '/tasks',
  '/checkin'
];

/** 是否隐藏某导航项（只对已登录且无经济资格的用户隐藏贡献点经济入口） */
export function shouldHideNavItem(user, to) {
  if (!user) return false;
  if (isEconomyMember(user)) return false;
  return ECONOMY_NAV_PATHS.some(p => to === p || to.startsWith(`${p}/`));
}

/** Admin 页签 → 所需权限（undefined 表示沿用旧 Level >= 1 语义） */
export const TAB_PERMISSIONS = {
  dashboard: ['admin.dashboard.view'],
  users: ['admin.users.view'],
  posts: ['admin.posts.moderate'],
  wiki: ['wiki.access'],
  announcements: ['announcement.create', 'announcement.edit', 'announcement.delete'],
  logs: ['economy.contribution_points.manage'],
  permissions: ['admin.permissions.manage', 'admin.permissions.view'],
  market: ['market.access', 'market.product.review', 'market.shop.manage', 'market.order.manage', 'market.dispute.manage', 'market.finance.manage']
};

/** 仅超级管理员可见的页签（原有语义） */
export const SUPER_ONLY_TABS = ['rag'];

/** 可看到某 Admin 页签 */
export function canSeeAdminTab(user, key) {
  if (!user) return false;
  if (SUPER_ONLY_TABS.includes(key)) return Number(user.level) >= 2;
  const perms = TAB_PERMISSIONS[key];
  if (!perms) return Number(user.level) >= 1;
  return hasAnyPermission(user, perms) || Number(user.level) >= 1;
}

/** 组件 hook：直接拿到当前 user 与判定函数 */
export function usePermissions() {
  const { user } = useAuth();
  return {
    user,
    hasPermission: (k) => hasPermission(user, k),
    hasAnyPermission: (keys) => hasAnyPermission(user, keys),
    isPermissionAdmin: isPermissionAdmin(user),
    canEnterAdmin: canEnterAdmin(user),
    isEconomyMember: isEconomyMember(user),
    canSeeAdminTab: (k) => canSeeAdminTab(user, k)
  };
}
