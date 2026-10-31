/**
 * notice 多账号改造（方案 B 第一步：全局活动账号切换）
 *
 * 设计：
 *  - .env 新增 NOTICE_ACCOUNTS（JSON 数组）：[{id,name,port,token,enabled}]
 *    未配置时自动回退到旧的单账号（ONEBOT_WS_PORT / ONEBOT_ACCESS_TOKEN），保证向后兼容
 *  - standalone.mjs：为每个启用账号建一个 OneBotWs 客户端，内存维护 activeAccountId
 *  - actions.call 走当前活动账号，其余业务代码（tasks/routes）零改动
 *  - routes.mjs 新增 GET /accounts、POST /accounts/active（需会话 + CSRF）
 *  - webui：顶部账号切换下拉 + 在线状态
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '_notice', 'xuanjian-notice');
const log = [];
const fail = [];

/* ============ 1. standalone.mjs：多账号客户端池 ============ */
{
    const p = path.join(ROOT, 'standalone.mjs');
    let s = fs.readFileSync(p, 'utf8');

    if (!s.includes('accountPool')) {
        // 1.1 读取账号配置（放在 ONEBOT_* 常量之后）
        s = s.replace(
            "const ONEBOT_TIMEOUT_MS = Number(env('ONEBOT_TIMEOUT_MS', '10000')) || 10000;",
            `const ONEBOT_TIMEOUT_MS = Number(env('ONEBOT_TIMEOUT_MS', '10000')) || 10000;

/**
 * 多账号配置：NOTICE_ACCOUNTS='[{"id":"xjj","name":"玄剑姬","port":13003,"token":"...","enabled":true}, ...]'
 * 未配置时回退为单账号（沿用 ONEBOT_WS_PORT / ONEBOT_ACCESS_TOKEN），保证旧部署可直接升级。
 */
function parseAccounts() {
  const raw = String(env('NOTICE_ACCOUNTS', '') || '').trim();
  if (!raw) {
    return [{ id: 'default', name: '玄剑姬', url: ONEBOT_WS_URL, token: ONEBOT_ACCESS_TOKEN, enabled: true }];
  }
  try {
    const arr = JSON.parse(raw);
    const list = (Array.isArray(arr) ? arr : [])
      .filter((a) => a && a.id && (a.port || a.url))
      .map((a) => ({
        id: String(a.id),
        name: String(a.name || a.id),
        url: String(a.url || \`ws://127.0.0.1:\${a.port}\`),
        token: String(a.token || ''),
        enabled: a.enabled !== false,
      }));
    if (!list.length) throw new Error('NOTICE_ACCOUNTS 为空或格式不对');
    return list;
  } catch (e) {
    console.error(PREFIX, '[accounts] NOTICE_ACCOUNTS 解析失败，回退单账号：' + e.message);
    return [{ id: 'default', name: '玄剑姬', url: ONEBOT_WS_URL, token: ONEBOT_ACCESS_TOKEN, enabled: true }];
  }
}

const ACCOUNT_DEFS = parseAccounts();
/** 账号池：id -> { def, client } */
const accountPool = new Map();
/** 当前活动账号 id（默认第一个启用的） */
let activeAccountId = (ACCOUNT_DEFS.find((a) => a.enabled) || ACCOUNT_DEFS[0]).id;

function getAccount(id) {
  const item = accountPool.get(String(id || ''));
  if (!item) throw new Error('账号不存在：' + id);
  if (!item.client) throw new Error('账号未启用：' + id);
  return item;
}

function activeAccount() {
  let item = accountPool.get(activeAccountId);
  if (!item || !item.client) {
    for (const [id, v] of accountPool) {
      if (v.client) { activeAccountId = id; item = v; break; }
    }
  }
  if (!item || !item.client) throw new Error('没有可用的 OneBot 账号');
  return item;
}

function accountsSnapshot() {
  return ACCOUNT_DEFS.map((a) => {
    const item = accountPool.get(a.id);
    let health = null;
    try { health = item && item.client ? item.client.health() : null; } catch { health = null; }
    return {
      id: a.id,
      name: a.name,
      enabled: !!a.enabled,
      active: a.id === activeAccountId,
      connected: !!(health && (health.connected || health.ready || health.state === 'open')),
      health,
    };
  });
}`
        );

        // 1.2 把单个 onebot 创建改为循环创建（替换原 createOneBotWs 调用块）
        s = s.replace(
            `const onebot = createOneBotWs({
  url: ONEBOT_WS_URL,
  token: ONEBOT_ACCESS_TOKEN,`,
            `const onebot = createOneBotWs({
  url: ONEBOT_WS_URL,
  token: ONEBOT_ACCESS_TOKEN,`
        );

        // 在 ctx 定义前，用池初始化：把原 onebot 变量保留为"默认账号客户端"，并额外建池
        s = s.replace(
            "const ctx = {",
            `/* 账号池初始化：每个启用账号一条 WS 连接 */
for (const def of ACCOUNT_DEFS) {
  if (!def.enabled) { accountPool.set(def.id, { def, client: null }); continue; }
  if (def.id === 'default' && def.url === ONEBOT_WS_URL) {
    accountPool.set(def.id, { def, client: onebot });
    continue;
  }
  try {
    const c = createOneBotWs({
      url: def.url,
      token: def.token,
      logger: { info: (...a) => console.log(PREFIX, ...a), warn: (...a) => console.warn(PREFIX, ...a), error: (...a) => console.error(PREFIX, ...a), debug: () => {} },
      timeoutMs: ONEBOT_TIMEOUT_MS,
    });
    c.start();
    accountPool.set(def.id, { def, client: c });
    console.log(PREFIX, '[accounts] 已启动账号 ' + def.id + '（' + def.name + '）→ ' + def.url);
  } catch (e) {
    console.error(PREFIX, '[accounts] 账号 ' + def.id + ' 启动失败：' + e.message);
    accountPool.set(def.id, { def, client: null });
  }
}

const ctx = {`
        );

        // 1.3 adapter 改为按活动账号路由
        s = s.replace(
            "actions: { call: (action, params) => onebot.call(action, params) },",
            `actions: {
    /** 未显式指定 accountId 时走当前活动账号 */
    call: (action, params, opts) => {
      const id = (opts && opts.accountId) || activeAccountId;
      return getAccount(id).client.call(action, params);
    },
  },`
        );

        // 1.4 暴露给 routes：ctx 上挂账号能力
        s = s.replace(
            `  router,
};`,
            `  router,
  /** 多账号能力（routes.mjs 使用） */
  accounts: {
    list: () => accountsSnapshot(),
    activeId: () => activeAccountId,
    setActive: (id) => {
      const item = getAccount(id);
      if (!item.client) throw new Error('该账号未启用');
      activeAccountId = String(id);
      return accountsSnapshot();
    },
    defs: () => ACCOUNT_DEFS,
  },
};`
        );
        log.push('standalone.mjs：账号池 + 活动账号路由 + ctx.accounts');
    }

    fs.writeFileSync(p, s, 'utf8');
}

console.log(log.map((l) => '  ✓ ' + l).join('\n') || '  （无改动）');
