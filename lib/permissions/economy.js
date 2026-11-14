/**
 * 贡献点经济资格：中央闸门规则表
 *
 * 背景：外会人员可能有网站账号，但不参与玄剑内部贡献点经济。
 * 是否参与**完全由角色决定**（「玄剑经济成员」角色授予 economy.contribution_points.*），与 Level 无关；
 * 失去资格 = 不发钱不删余额，保留余额与全部历史流水，重新获得角色后自动恢复。
 *
 * 这里只登记“真实存在的后端写/读入口”，由 economyGate 在路由前统一校验，
 * 避免出现“前端隐藏按钮、后端仍可用”的绕过；未列入的入口会在交付报告中列为遗留项。
 *
 * perm 语义：
 *   access   查看自己的余额/流水（经济账户准入）
 *   earn     获取贡献点
 *   spend    消费贡献点
 *   transfer 转账贡献点
 * 后三项以 access 为前提（resolver 的 economy 标志已内置该前置约束）。
 */

const ECON = 'economy.contribution_points';

/** 规则表：method + 正则匹配 pathname（不含 query） */
const RULES = [
    // ===== 账户准入（access）=====
    { method: 'GET', pattern: /^\/api\/contributions\/logs$/, perm: 'access', note: '查看自己的贡献点流水' },
    { method: 'GET', pattern: /^\/api\/checkin\/status$/, perm: 'access', note: '签到状态（返回贡献点余额相关）' },
    { method: 'GET', pattern: /^\/api\/checkin\/history$/, perm: 'access', note: '签到历史（含贡献点奖励）' },
    { method: 'GET', pattern: /^\/api\/pay\/records$/, perm: 'access', note: '扫码支付记录（贡献点）' },
    { method: 'GET', pattern: /^\/api\/pay\/members$/, perm: 'access', note: '支付成员列表（贡献点）' },
    { method: 'GET', pattern: /^\/api\/pay\/charges$/, perm: 'access', note: '缴费单列表（贡献点）' },
    { method: 'GET', pattern: /^\/api\/pay\/payer-code\/current$/, perm: 'access', note: '付款码（贡献点余额展示）' },
    { method: 'GET', pattern: /^\/api\/pay\/payer-code\/pending$/, perm: 'access', note: '待支付付款码（贡献点）' },
    { method: 'GET', pattern: /^\/api\/pay\/intents\/[^/]+$/, perm: 'access', note: '支付单详情（贡献点）' },

    // ===== 获取贡献点（earn）=====
    { method: 'POST', pattern: /^\/api\/checkin\/checkin$/, perm: 'earn', note: '签到获得贡献点' },
    { method: 'POST', pattern: /^\/api\/checkin\/makeup$/, perm: 'earn', note: '补签获得贡献点' },
    { method: 'POST', pattern: /^\/api\/tasks\/\d+\/complete$/, perm: 'earn', note: '完成任务获得贡献点' },
    { method: 'POST', pattern: /^\/api\/player-tasks\/\d+\/complete$/, perm: 'earn', note: '完成玩家任务获得贡献点' },
    { method: 'POST', pattern: /^\/api\/express-index\/sell$/, perm: 'earn', note: '股市卖出获得贡献点' },

    // ===== 消费贡献点（spend）=====
    { method: 'POST', pattern: /^\/api\/checkin\/buy-makeup-card$/, perm: 'spend', note: '购买补签卡' },
    { method: 'POST', pattern: /^\/api\/shop\/items\/\d+\/buy$/, perm: 'spend', note: '商城购买' },
    { method: 'POST', pattern: /^\/api\/titles\/\d+\/buy$/, perm: 'spend', note: '购买头衔' },
    { method: 'POST', pattern: /^\/api\/chat\/bubbles\/\d+\/buy$/, perm: 'spend', note: '购买聊天气泡' },
    { method: 'POST', pattern: /^\/api\/player-tasks$/, perm: 'spend', note: '发布玩家任务（托管贡献点）' },
    { method: 'POST', pattern: /^\/api\/market\/orders$/, perm: 'spend', note: '集市下单支付贡献点' },
    { method: 'POST', pattern: /^\/api\/express-index\/buy$/, perm: 'spend', note: '股市买入扣除贡献点' },
    { method: 'POST', pattern: /^\/api\/contribution-conversion\/\d+\/apply$/, perm: 'spend', note: '换服折算（贡献点）' },
    { method: 'POST', pattern: /^\/api\/pay\/scan$/, perm: 'spend', note: '扫码支付贡献点' },
    { method: 'POST', pattern: /^\/api\/pay\/intents\/[^/]+\/confirm$/, perm: 'spend', note: '确认支付贡献点' },
    { method: 'POST', pattern: /^\/api\/pay\/charge\/[^/]+\/pay$/, perm: 'spend', note: '缴费单支付贡献点' },

    // ===== 转账贡献点（transfer）=====
    { method: 'POST', pattern: /^\/api\/contributions\/transfer$/, perm: 'transfer', note: '贡献点转账' }
];

const PERM_LABEL = {
    access: '查看贡献点余额与流水',
    earn: '获取贡献点',
    spend: '消费贡献点',
    transfer: '转账贡献点'
};

function matchRule(method, pathname) {
    const m = String(method || '').toUpperCase();
    for (const rule of RULES) {
        if (rule.method !== m) continue;
        if (rule.pattern.test(pathname)) return rule;
    }
    return null;
}

/** 规则表导出（测试与报告核对用） */
function listRules() {
    return RULES.map(r => ({
        method: r.method,
        pattern: r.pattern.source,
        permission: `${ECON}.${r.perm}`,
        perm: r.perm,
        note: r.note
    }));
}

module.exports = { ECON, RULES, PERM_LABEL, matchRule, listRules };
