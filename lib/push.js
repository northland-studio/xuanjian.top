/**
 * Web Push（站外系统级浏览器弹窗通知）
 * 基于 web-push + VAPID。用户在前端订阅后，服务端向浏览器推送服务发送通知，
 * 即使网页关闭也能弹出系统级通知。
 */
const webpush = require('web-push');
const logger = require('./logger');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:xuanjian_guild@xuanjian.top';

// 配置 VAPID（若未配置则推送功能禁用，但模块可正常加载）
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

/** 判断 Web Push 是否已启用（VAPID 配置齐全） */
function isEnabled() {
    return !!(VAPID_PUBLIC && VAPID_PRIVATE);
}

/** 前端获取 VAPID 公钥（用于订阅） */
function getPublicKey() {
    return VAPID_PUBLIC || '';
}

/**
 * 向单个订阅推送一条通知
 * @param {object} subscription { endpoint, keys:{p256dh, auth} }
 * @param {object} payload { title, body, url, icon }
 */
async function sendPush(subscription, payload) {
    if (!isEnabled()) return false;
    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
        return true;
    } catch (err) {
        // 410/404 = 订阅已失效（用户取消或浏览器卸载），应删除
        if (err.statusCode === 410 || err.statusCode === 404) {
            return 'expired';
        }
        logger.error('Web Push 发送失败:', err.message);
        return false;
    }
}

/**
 * 向某用户的所有订阅推送通知
 * @param {Array<object>} subscriptions 该用户的订阅列表
 * @param {object} payload
 */
async function sendPushToSubscriptions(subscriptions, payload) {
    if (!isEnabled() || !subscriptions || !subscriptions.length) return 0;
    const expired = [];
    let sent = 0;
    for (const sub of subscriptions) {
        const result = await sendPush(JSON.parse(sub.subscription_json), payload);
        if (result === true) sent++;
        else if (result === 'expired') expired.push(sub.id);
    }
    return { sent, expired };
}

module.exports = { isEnabled, getPublicKey, sendPush, sendPushToSubscriptions };
