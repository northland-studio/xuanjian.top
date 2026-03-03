const express = require('express');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const router = express.Router();

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function getYesterdayDate() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
}

async function getRewardForDays(days) {
    const rewards = await db.all(
        'SELECT continuous_days, reward_points FROM checkin_rewards ORDER BY continuous_days DESC'
    );
    
    for (const reward of rewards) {
        if (days >= reward.continuous_days) {
            return reward.reward_points;
        }
    }
    return 5;
}

router.post('/checkin', authMiddleware, async (req, res) => {
    try {
        const today = getTodayDate();
        const yesterday = getYesterdayDate();
        
        const existingCheckin = await db.get(
            'SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [req.userId, today]
        );
        
        if (existingCheckin) {
            return res.status(400).json({ error: '今日已签到' });
        }
        
        const yesterdayCheckin = await db.get(
            'SELECT continuous_days FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [req.userId, yesterday]
        );
        
        let continuousDays = 1;
        if (yesterdayCheckin) {
            continuousDays = yesterdayCheckin.continuous_days + 1;
        }
        
        const rewardPoints = await getRewardForDays(continuousDays);
        
        await db.run(
            'INSERT INTO checkins (user_id, checkin_date, continuous_days, reward_points, created_at) VALUES (?, ?, ?, ?, ?)',
            [req.userId, today, continuousDays, rewardPoints, getLocalTimestamp()]
        );
        
        await db.run(
            'UPDATE users SET contribution = contribution + ? WHERE id = ?',
            [rewardPoints, req.userId]
        );
        
        const user = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        
        res.json({
            message: '签到成功',
            continuousDays,
            rewardPoints,
            totalContribution: user.contribution,
            isNewRecord: continuousDays > 1
        });
    } catch (error) {
        console.error('签到错误:', error);
        res.status(500).json({ error: '签到失败' });
    }
});

router.post('/makeup', authMiddleware, async (req, res) => {
    try {
        const { targetDate } = req.body;
        
        if (!targetDate) {
            return res.status(400).json({ error: '请指定补签日期' });
        }
        
        const target = new Date(targetDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (target >= today) {
            return res.status(400).json({ error: '只能补签过去的日期' });
        }
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        if (target < sevenDaysAgo) {
            return res.status(400).json({ error: '只能补签最近7天内的日期' });
        }
        
        const existingCheckin = await db.get(
            'SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [req.userId, targetDate]
        );
        
        if (existingCheckin) {
            return res.status(400).json({ error: '该日期已签到' });
        }
        
        let makeupCards = await db.get(
            'SELECT quantity FROM makeup_cards WHERE user_id = ?',
            [req.userId]
        );
        
        if (!makeupCards || makeupCards.quantity <= 0) {
            return res.status(400).json({ error: '补签卡不足，请先购买补签卡' });
        }
        
        const dayBefore = new Date(target);
        dayBefore.setDate(dayBefore.getDate() - 1);
        const dayBeforeStr = dayBefore.toISOString().split('T')[0];
        
        const dayAfter = new Date(target);
        dayAfter.setDate(dayAfter.getDate() + 1);
        const dayAfterStr = dayAfter.toISOString().split('T')[0];
        
        const beforeCheckin = await db.get(
            'SELECT continuous_days FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [req.userId, dayBeforeStr]
        );
        
        const afterCheckin = await db.get(
            'SELECT continuous_days FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [req.userId, dayAfterStr]
        );
        
        let continuousDays = 1;
        if (beforeCheckin) {
            continuousDays = beforeCheckin.continuous_days + 1;
        }
        
        const rewardPoints = await getRewardForDays(continuousDays);
        
        await db.run(
            'INSERT INTO checkins (user_id, checkin_date, continuous_days, reward_points, created_at) VALUES (?, ?, ?, ?, ?)',
            [req.userId, targetDate, continuousDays, rewardPoints, getLocalTimestamp()]
        );
        
        await db.run(
            'UPDATE makeup_cards SET quantity = quantity - 1, updated_at = ? WHERE user_id = ?',
            [getLocalTimestamp(), req.userId]
        );
        
        await db.run(
            'INSERT INTO makeup_usage (user_id, target_date, used_at) VALUES (?, ?, ?)',
            [req.userId, targetDate, getLocalTimestamp()]
        );
        
        await db.run(
            'UPDATE users SET contribution = contribution + ? WHERE id = ?',
            [rewardPoints, req.userId]
        );
        
        if (afterCheckin) {
            const newContinuousDays = continuousDays + 1;
            let currentCheckDate = dayAfter;
            
            while (true) {
                const checkDateStr = currentCheckDate.toISOString().split('T')[0];
                const checkin = await db.get(
                    'SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?',
                    [req.userId, checkDateStr]
                );
                
                if (!checkin) break;
                
                await db.run(
                    'UPDATE checkins SET continuous_days = ? WHERE user_id = ? AND checkin_date = ?',
                    [newContinuousDays, req.userId, checkDateStr]
                );
                
                currentCheckDate.setDate(currentCheckDate.getDate() + 1);
            }
        }
        
        const user = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        makeupCards = await db.get('SELECT quantity FROM makeup_cards WHERE user_id = ?', [req.userId]);
        
        res.json({
            message: '补签成功',
            targetDate,
            rewardPoints,
            remainingCards: makeupCards?.quantity || 0,
            totalContribution: user.contribution
        });
    } catch (error) {
        console.error('补签错误:', error);
        res.status(500).json({ error: '补签失败' });
    }
});

router.post('/buy-makeup-card', authMiddleware, async (req, res) => {
    try {
        const { quantity = 1 } = req.body;
        const cost = 50 * quantity;
        
        const user = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        
        if (user.contribution < cost) {
            return res.status(400).json({ error: '贡献点不足，购买一张补签卡需要50贡献点' });
        }
        
        await db.run(
            'UPDATE users SET contribution = contribution - ? WHERE id = ?',
            [cost, req.userId]
        );
        
        const existingCards = await db.get(
            'SELECT * FROM makeup_cards WHERE user_id = ?',
            [req.userId]
        );
        
        if (existingCards) {
            await db.run(
                'UPDATE makeup_cards SET quantity = quantity + ?, updated_at = ? WHERE user_id = ?',
                [quantity, getLocalTimestamp(), req.userId]
            );
        } else {
            await db.run(
                'INSERT INTO makeup_cards (user_id, quantity, updated_at) VALUES (?, ?, ?)',
                [req.userId, quantity, getLocalTimestamp()]
            );
        }
        
        const updatedUser = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        const cards = await db.get('SELECT quantity FROM makeup_cards WHERE user_id = ?', [req.userId]);
        
        res.json({
            message: '购买成功',
            quantity,
            cost,
            remainingCards: cards.quantity,
            totalContribution: updatedUser.contribution
        });
    } catch (error) {
        console.error('购买补签卡错误:', error);
        res.status(500).json({ error: '购买失败' });
    }
});

router.get('/status', authMiddleware, async (req, res) => {
    try {
        const today = getTodayDate();
        const yesterday = getYesterdayDate();
        
        const todayCheckin = await db.get(
            'SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [req.userId, today]
        );
        
        const yesterdayCheckin = await db.get(
            'SELECT continuous_days FROM checkins WHERE user_id = ? AND checkin_date = ?',
            [req.userId, yesterday]
        );
        
        const latestCheckin = await db.get(
            'SELECT * FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1',
            [req.userId]
        );
        
        let continuousDays = 0;
        if (todayCheckin) {
            continuousDays = todayCheckin.continuous_days;
        } else if (yesterdayCheckin) {
            continuousDays = yesterdayCheckin.continuous_days;
        } else if (latestCheckin) {
            const latestDate = new Date(latestCheckin.checkin_date);
            const todayDate = new Date(today);
            const diffDays = Math.floor((todayDate - latestDate) / (1000 * 60 * 60 * 24));
            if (diffDays > 1) {
                continuousDays = 0;
            }
        }
        
        const totalCheckins = await db.get(
            'SELECT COUNT(*) as count FROM checkins WHERE user_id = ?',
            [req.userId]
        );
        
        const maxContinuous = await db.get(
            'SELECT MAX(continuous_days) as max FROM checkins WHERE user_id = ?',
            [req.userId]
        );
        
        const makeupCards = await db.get(
            'SELECT quantity FROM makeup_cards WHERE user_id = ?',
            [req.userId]
        );
        
        const user = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        
        const rewards = await db.all(
            'SELECT continuous_days, reward_points, description FROM checkin_rewards ORDER BY continuous_days'
        );
        
        const recentCheckins = await db.all(
            'SELECT checkin_date, continuous_days, reward_points FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 30',
            [req.userId]
        );
        
        res.json({
            todayCheckedIn: !!todayCheckin,
            continuousDays,
            totalCheckins: totalCheckins.count || 0,
            maxContinuousDays: maxContinuous.max || 0,
            makeupCards: makeupCards?.quantity || 0,
            totalContribution: user.contribution || 0,
            rewards,
            recentCheckins,
            todayReward: todayCheckin ? todayCheckin.reward_points : await getRewardForDays(continuousDays + 1)
        });
    } catch (error) {
        console.error('获取签到状态错误:', error);
        res.status(500).json({ error: '获取签到状态失败' });
    }
});

router.get('/history', authMiddleware, async (req, res) => {
    try {
        const { year, month } = req.query;
        
        let whereClause = 'WHERE user_id = ?';
        const params = [req.userId];
        
        if (year && month) {
            whereClause += ' AND strftime("%Y", checkin_date) = ? AND strftime("%m", checkin_date) = ?';
            params.push(year, month.padStart(2, '0'));
        }
        
        const checkins = await db.all(
            `SELECT checkin_date, continuous_days, reward_points FROM checkins ${whereClause} ORDER BY checkin_date`,
            params
        );
        
        res.json({ checkins });
    } catch (error) {
        console.error('获取签到历史错误:', error);
        res.status(500).json({ error: '获取签到历史失败' });
    }
});

router.get('/leaderboard', async (req, res) => {
    try {
        const { type = 'continuous', limit = 10 } = req.query;
        
        let orderBy = 'continuous_days DESC';
        if (type === 'total') {
            orderBy = 'total_checkins DESC';
        }
        
        const leaderboard = await db.all(
            `SELECT u.id, u.username, u.nickname, u.avatar, 
                    MAX(c.continuous_days) as continuous_days,
                    COUNT(c.id) as total_checkins
             FROM users u
             LEFT JOIN checkins c ON u.id = c.user_id
             GROUP BY u.id
             HAVING total_checkins > 0
             ORDER BY ${orderBy}
             LIMIT ?`,
            [parseInt(limit)]
        );
        
        res.json({ leaderboard, type });
    } catch (error) {
        console.error('获取排行榜错误:', error);
        res.status(500).json({ error: '获取排行榜失败' });
    }
});

router.post('/rewards', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { continuous_days, reward_points, description } = req.body;
        
        if (!continuous_days || !reward_points) {
            return res.status(400).json({ error: '连续天数和奖励贡献点不能为空' });
        }
        
        await db.run(
            'INSERT OR REPLACE INTO checkin_rewards (continuous_days, reward_points, description) VALUES (?, ?, ?)',
            [continuous_days, reward_points, description || `连续${continuous_days}天`]
        );
        
        res.json({ message: '奖励设置成功' });
    } catch (error) {
        console.error('设置奖励错误:', error);
        res.status(500).json({ error: '设置奖励失败' });
    }
});

router.get('/rewards', async (req, res) => {
    try {
        const rewards = await db.all(
            'SELECT continuous_days, reward_points, description FROM checkin_rewards ORDER BY continuous_days'
        );
        
        res.json({ rewards });
    } catch (error) {
        console.error('获取奖励列表错误:', error);
        res.status(500).json({ error: '获取奖励列表失败' });
    }
});

module.exports = router;
