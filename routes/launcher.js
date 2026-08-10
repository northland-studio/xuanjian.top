/**
 * PCL 启动器动态主页（XAML 生成器）
 * 每次请求时从数据库实时烘焙内容，PCL 启动页填入 https://xuanjian.top/launcher/home.xaml 即为最新
 * 返回纯 XAML（连续 local:MyCard 卡片，命名空间由 PCL 自动声明），无需 JS 即可动态更新
 */
const express = require('express');
const logger = require('../lib/logger');
const db = require('../database');
const router = express.Router();

const SITE = 'https://xuanjian.top';

// XAML 转义（含换行）
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\r?\n/g, '&#xA;');
}

// 卡片容器
function card(title, inner, expanded) {
    const swapped = expanded ? 'False' : 'True';
    return `<local:MyCard Title="${esc(title)}" Margin="0,0,0,12" CanSwap="True" IsSwapped="${swapped}"><StackPanel Margin="25,36,23,14">${inner}</StackPanel></local:MyCard>`;
}

// 文本（extra 若已含 FontSize 则不重复输出默认字号）
function text(content, extra = '') {
    const sizeAttr = /\bFontSize=/.test(extra) ? '' : 'FontSize="12" ';
    return `<TextBlock TextWrapping="Wrap" Margin="0,2,0,4" ${sizeAttr}${extra} Text="${esc(content)}" />`;
}

// 提示条
function hint(content, theme = 'Blue') {
    return `<local:MyHint Margin="0,2,0,6" Theme="${theme}" Text="${esc(content)}" />`;
}

// 列表项（点击打开网页）
function listItem(title, info, url) {
    return `<local:MyListItem Title="${esc(title)}" Info="${esc(info)}" Type="Clickable" EventType="打开网页" EventData="${esc(url)}" />`;
}

// 按钮
function button(label, eventType, eventData, colorType = 'Highlight') {
    return `<local:MyButton Margin="0,4,0,4" Height="32" Padding="20,0,20,0" HorizontalAlignment="Left" ColorType="${colorType}" Text="${esc(label)}" EventType="${esc(eventType)}" EventData="${esc(eventData)}" />`;
}

router.get('/home.xaml', async (req, res) => {
    try {
        const ttl = '-60 minutes';
        const [
            online,
            announcements,
            dailies,
            decisions,
            projections,
            banners,
            serverRow
        ] = await Promise.all([
            db.all(
                `SELECT o.player_name AS name FROM mod_online o
                 JOIN mod_bindings b ON o.uuid = b.uuid AND b.status = 'confirmed'
                 WHERE o.updated_at >= datetime('now', 'localtime', ?)
                 ORDER BY o.player_name`,
                [ttl]
            ).catch(() => []),
            db.all(
                `SELECT title, content, created_at FROM announcements
                 WHERE is_active = 1 ORDER BY created_at DESC LIMIT 3`
            ).catch(() => []),
            db.all(
                `SELECT id, title, created_at FROM posts
                 WHERE type = 'daily' AND status = 'active' ORDER BY created_at DESC LIMIT 3`
            ).catch(() => []),
            db.all(
                `SELECT id, title, created_at FROM posts
                 WHERE type = 'decision' AND status = 'active' ORDER BY created_at DESC LIMIT 2`
            ).catch(() => []),
            db.all(
                `SELECT id, title, description, downloads FROM projections ORDER BY id DESC LIMIT 5`
            ).catch(() => []),
            db.all(
                `SELECT title, subtitle, image, link FROM banners WHERE is_active = 1 ORDER BY sort_order ASC, id ASC LIMIT 1`
            ).catch(() => []),
            db.get(`SELECT server_ip FROM mod_servers ORDER BY id ASC LIMIT 1`).catch(() => null)
        ]);

        const serverIp = serverRow && serverRow.server_ip ? serverRow.server_ip : 'EririLily.cn';
        const parts = [];

        // 1. 品牌卡：Logo + 加入服务器
        let brand = '';
        brand += `<local:MyImage Height="64" HorizontalAlignment="Center" Source="${esc(SITE + '/icon.png')}" EnableCache="True" />`;
        brand += hint(`欢迎使用玄剑公会启动器主页 · 服务器 ${esc(serverIp)}`, 'Blue');
        brand += `<StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,6,0,0">`;
        brand += `<local:MyButton Margin="0,0,10,0" Height="34" Padding="22,0,22,0" ColorType="Highlight" Text="启动游戏并进入服务器" EventType="启动游戏" EventData="${esc('\\current|' + serverIp)}" />`;
        brand += `<local:MyButton Height="34" Padding="22,0,22,0" Text="复制服务器地址" EventType="复制文本" EventData="${esc(serverIp)}" />`;
        brand += `</StackPanel>`;
        brand += `<StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,4,0,0">`;
        brand += `<local:MyTextButton Text="访问官网" EventType="打开网页" EventData="${esc(SITE)}" />`;
        brand += `<local:MyTextButton Margin="18,0,0,0" Text="加入QQ群" EventType="打开网页" EventData="https://qm.qq.com/cgi-bin/qm/qr?k=xuanjian" />`;
        brand += `</StackPanel>`;
        if (banners[0] && banners[0].image) {
            brand += text(`轮播：${banners[0].title || ''}${banners[0].subtitle ? ' - ' + banners[0].subtitle : ''}`, 'Foreground="#8C8C8C" FontSize="11"');
        }
        parts.push(card('玄剑公会', brand, true));

        // 2. 在线状态卡
        let onlineBlock = '';
        if (online.length === 0) {
            onlineBlock += hint('当前暂无玄剑成员在线', 'Blue');
        } else {
            onlineBlock += hint(`当前有 ${online.length} 位玄剑成员在线`, 'Blue');
            const names = online.map(o => o.name).join('、');
            onlineBlock += text(names, 'Foreground="#3AA76D" FontWeight="Bold"');
        }
        parts.push(card('在线成员', onlineBlock, true));

        // 3. 公告卡
        let annBlock = '';
        if (announcements.length === 0) {
            annBlock += text('暂无公告');
        } else {
            for (const a of announcements) {
                annBlock += hint(a.title || '公告', 'Yellow');
                annBlock += text((a.content || '').slice(0, 200), 'Foreground="#8C8C8C" FontSize="11"');
            }
        }
        parts.push(card('最新公告', annBlock, true));

        // 4. 日报卡
        let dailyBlock = '';
        if (dailies.length === 0) {
            dailyBlock += text('暂无日报');
        } else {
            for (const p of dailies) {
                dailyBlock += listItem(p.title, (p.created_at || '').slice(0, 10), `${SITE}/post/${p.id}`);
            }
        }
        dailyBlock += `<local:MyTextButton Margin="0,6,0,0" Text="查看全部日报 →" HorizontalAlignment="Right" EventType="打开网页" EventData="${esc(SITE + '/daily')}" />`;
        parts.push(card('公会日报', dailyBlock, false));

        // 5. 决策公示卡
        let decBlock = '';
        if (decisions.length === 0) {
            decBlock += text('暂无决策');
        } else {
            for (const p of decisions) {
                decBlock += listItem(p.title, (p.created_at || '').slice(0, 10), `${SITE}/post/${p.id}`);
            }
        }
        decBlock += `<local:MyTextButton Margin="0,6,0,0" Text="查看全部决策 →" HorizontalAlignment="Right" EventType="打开网页" EventData="${esc(SITE + '/decision')}" />`;
        parts.push(card('决策公示', decBlock, false));

        // 6. 客户端更新卡
        let updBlock = '';
        updBlock += text('玄剑联动模组 v1.0.0（Fabric，支持 1.21.11 / 26.2 双版本）', 'FontWeight="Bold"');
        updBlock += text('提供绑定、签到、任务、贡献点、在线同步等联动功能，客户端安装即可使用', 'Foreground="#8C8C8C" FontSize="11"');
        updBlock += button('前往模组页下载', '打开网页', SITE + '/mods');
        parts.push(card('客户端更新', updBlock, false));

        // 7. 投影仓库卡
        let projBlock = '';
        if (projections.length === 0) {
            projBlock += text('暂无投影');
        } else {
            for (const p of projections) {
                projBlock += listItem(p.title, `下载 ${p.downloads} 次`, `${SITE}/projections`);
            }
        }
        projBlock += `<local:MyTextButton Margin="0,6,0,0" Text="进入投影仓库 →" HorizontalAlignment="Right" EventType="打开网页" EventData="${esc(SITE + '/projections')}" />`;
        parts.push(card('投影仓库', projBlock, false));

        // 8. 快捷入口卡
        let quick = `<StackPanel Orientation="Horizontal" HorizontalAlignment="Center">`;
        quick += `<local:MyButton Margin="0,0,10,0" Height="32" Padding="18,0,18,0" Text="贴吧" EventType="打开网页" EventData="${esc(SITE + '/forum')}" />`;
        quick += `<local:MyButton Margin="0,0,10,0" Height="32" Padding="18,0,18,0" Text="商城" EventType="打开网页" EventData="${esc(SITE + '/shop')}" />`;
        quick += `<local:MyButton Margin="0,0,10,0" Height="32" Padding="18,0,18,0" Text="排行榜" EventType="打开网页" EventData="${esc(SITE + '/rankings')}" />`;
        quick += `<local:MyButton Margin="0,0,10,0" Height="32" Padding="18,0,18,0" Text="签到" EventType="打开网页" EventData="${esc(SITE + '/checkin')}" />`;
        quick += `<local:MyButton Height="32" Padding="18,0,18,0" ColorType="Highlight" Text="任务中心" EventType="打开网页" EventData="${esc(SITE + '/tasks')}" />`;
        quick += `</StackPanel>`;
        parts.push(card('快捷入口', quick, true));

        // 9. 页脚
        parts.push(`<local:MyCard Title="关于" Margin="0,0,0,12" CanSwap="True" IsSwapped="True"><StackPanel Margin="25,36,23,14">${text('© 2026 我的世界玄剑公会 · 由 北域工作室 Northland Studio 出品', 'HorizontalAlignment="Center" FontSize="11" Foreground="#8C8C8C"')}</StackPanel></local:MyCard>`);

        const xaml = parts.join('\n');
        res.set({
            'Content-Type': 'application/xaml+xml; charset=utf-8',
            'Cache-Control': 'no-cache, no-store',
        });
        res.send(xaml);
    } catch (error) {
        logger.error('生成 PCL 主页错误:', error);
        res.status(500).send('<!-- 生成失败 -->');
    }
});

module.exports = router;
