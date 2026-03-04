const express = require('express');
const db = require('../database');
const { getLocalTimestamp } = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const router = express.Router();

const PRICE_SENSITIVITY = 0.005;
const CIRCUIT_BREAKER = 0.10;
const USER_TRADE_LIMIT_RATIO = 0.05;
const MARKET_MAKER_BASE_VOLUME = 100;
const TRADE_WINDOW_MINUTES = 5;

const TRADE_COOLDOWN_MINUTES = 60;

function getLocalTimeStr(date) {
    const offset = date.getTimezoneOffset() * 60000;
    const localTime = new Date(date - offset);
    return localTime.toISOString().slice(0, 19).replace('T', ' ');
}

async function checkTradeCooldown(userId, stockId, tradeType) {
    const oppositeType = tradeType === 'buy' ? 'sell' : 'buy';
    const cooldownStart = new Date(Date.now() - TRADE_COOLDOWN_MINUTES * 60 * 1000);
    const cooldownStartStr = getLocalTimeStr(cooldownStart);
    
    const lastTrade = await db.get(
        `SELECT created_at FROM stock_transactions 
         WHERE user_id = ? AND stock_id = ? AND type = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
        [userId, stockId, oppositeType, cooldownStartStr]
    );
    
    return lastTrade;
}

async function updateStockPrices() {
    try {
        const stocks = await db.all('SELECT * FROM stocks WHERE is_active = 1');
        const now = getLocalTimestamp();
        
        for (const stock of stocks) {
            const windowStart = new Date(Date.now() - TRADE_WINDOW_MINUTES * 60 * 1000);
            const windowStartStr = getLocalTimeStr(windowStart);
            
            const trades = await db.all(
                `SELECT type, shares, price, total_cost FROM stock_transactions 
                 WHERE stock_id = ? AND created_at >= ?`,
                [stock.id, windowStartStr]
            );
            
            let netBuyVolume = 0;
            let totalTradeValue = 0;
            
            trades.forEach(trade => {
                const value = trade.total_cost || (trade.shares * trade.price);
                totalTradeValue += value;
                
                if (trade.type === 'buy') {
                    netBuyVolume += trade.shares;
                } else {
                    netBuyVolume -= trade.shares;
                }
            });
            
            const tradeDrivenFactor = (netBuyVolume * PRICE_SENSITIVITY) / stock.total_shares;
            
            const randomFactor = (Math.random() - 0.5) * 2 * stock.volatility * 0.5;
            const trendFactor = stock.trend * 0.05;
            
            const totalChange = tradeDrivenFactor * 0.6 + randomFactor * 0.3 + trendFactor * 0.1;
            
            let newPrice = stock.current_price * (1 + totalChange);
            
            const maxChange = stock.current_price * CIRCUIT_BREAKER;
            const minPrice = Math.max(stock.base_price * 0.1, stock.current_price - maxChange);
            const maxPrice = Math.min(stock.base_price * 5, stock.current_price + maxChange);
            newPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));
            
            newPrice = Math.round(newPrice * 100) / 100;
            
            await db.run(
                'UPDATE stocks SET current_price = ?, updated_at = ? WHERE id = ?',
                [newPrice, now, stock.id]
            );
            
            const marketMakerVolume = Math.floor(MARKET_MAKER_BASE_VOLUME * (0.5 + Math.random()));
            await db.run(
                'INSERT INTO stock_prices (stock_id, price, volume, recorded_at) VALUES (?, ?, ?, ?)',
                [stock.id, newPrice, marketMakerVolume, now]
            );
            
            await db.run(
                `DELETE FROM stock_prices WHERE stock_id = ? AND id NOT IN (
                    SELECT id FROM stock_prices WHERE stock_id = ? ORDER BY recorded_at DESC LIMIT 100
                )`,
                [stock.id, stock.id]
            );
        }
    } catch (err) {
        console.error('更新股票价格失败:', err);
    }
}

setInterval(updateStockPrices, 60000);

router.get('/stocks', async (req, res) => {
    try {
        const stocks = await db.all(
            'SELECT id, symbol, name, description, base_price, current_price, total_shares, available_shares, volatility, trend, is_active, updated_at FROM stocks WHERE is_active = 1 ORDER BY symbol'
        );
        
        res.json({ stocks });
    } catch (error) {
        console.error('获取股票列表错误:', error);
        res.status(500).json({ error: '获取股票列表失败' });
    }
});

router.get('/stocks/all', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const stocks = await db.all(
            'SELECT id, symbol, name, description, base_price, current_price, total_shares, available_shares, volatility, trend, is_active, updated_at FROM stocks ORDER BY symbol'
        );
        
        res.json({ stocks });
    } catch (error) {
        console.error('获取股票列表错误:', error);
        res.status(500).json({ error: '获取股票列表失败' });
    }
});

router.get('/stocks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const stock = await db.get(
            'SELECT id, symbol, name, description, base_price, current_price, total_shares, available_shares, volatility, trend, is_active FROM stocks WHERE id = ?',
            [id]
        );
        
        if (!stock) {
            return res.status(404).json({ error: '股票不存在' });
        }
        
        const prices = await db.all(
            'SELECT price, volume, recorded_at FROM stock_prices WHERE stock_id = ? ORDER BY recorded_at DESC LIMIT 50',
            [id]
        );
        
        res.json({ stock, prices: prices.reverse() });
    } catch (error) {
        console.error('获取股票详情错误:', error);
        res.status(500).json({ error: '获取股票详情失败' });
    }
});

router.get('/stocks/:id/history', async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 100 } = req.query;
        
        const prices = await db.all(
            'SELECT price, volume, recorded_at FROM stock_prices WHERE stock_id = ? ORDER BY recorded_at DESC LIMIT ?',
            [id, parseInt(limit)]
        );
        
        res.json({ prices: prices.reverse() });
    } catch (error) {
        console.error('获取股票历史错误:', error);
        res.status(500).json({ error: '获取股票历史失败' });
    }
});

router.get('/portfolio', authMiddleware, async (req, res) => {
    try {
        const holdings = await db.all(
            `SELECT us.*, s.symbol, s.name, s.current_price, s.base_price,
                    (us.shares * s.current_price) as current_value,
                    (us.shares * s.current_price - us.shares * us.avg_cost) as profit_loss
             FROM user_stocks us
             JOIN stocks s ON us.stock_id = s.id
             WHERE us.user_id = ? AND us.shares > 0`,
            [req.userId]
        );
        
        const user = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        
        let totalValue = Math.round((user.contribution || 0) * 100) / 100;
        let totalProfit = 0;
        
        holdings.forEach(h => {
            h.current_value = Math.round(h.current_value * 100) / 100;
            h.profit_loss = Math.round(h.profit_loss * 100) / 100;
            h.avg_cost = Math.round(h.avg_cost * 100) / 100;
            totalValue += h.current_value;
            totalProfit += h.profit_loss;
        });
        
        totalValue = Math.round(totalValue * 100) / 100;
        totalProfit = Math.round(totalProfit * 100) / 100;
        
        res.json({ 
            holdings, 
            availablePoints: Math.round((user.contribution || 0) * 100) / 100,
            totalValue,
            totalProfit
        });
    } catch (error) {
        console.error('获取投资组合错误:', error);
        res.status(500).json({ error: '获取投资组合失败' });
    }
});

router.post('/stocks/:id/buy', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { shares } = req.body;
        
        if (!shares || shares <= 0) {
            return res.status(400).json({ error: '购买数量必须大于0' });
        }
        
        const cooldownTrade = await checkTradeCooldown(req.userId, parseInt(id), 'buy');
        if (cooldownTrade) {
            return res.status(400).json({ error: '卖出后需等待1小时才能买入该股票' });
        }
        
        const stock = await db.get('SELECT * FROM stocks WHERE id = ? AND is_active = 1', [id]);
        if (!stock) {
            return res.status(404).json({ error: '股票不存在' });
        }
        
        const maxSharesPerTrade = Math.floor(stock.total_shares * USER_TRADE_LIMIT_RATIO);
        if (shares > maxSharesPerTrade) {
            return res.status(400).json({ error: `单次交易上限为 ${maxSharesPerTrade} 股` });
        }
        
        if (stock.available_shares < shares) {
            return res.status(400).json({ error: '可用股份不足' });
        }
        
        const totalCost = Math.round(stock.current_price * shares * 100) / 100;
        
        const user = await db.get('SELECT contribution FROM users WHERE id = ?', [req.userId]);
        if (user.contribution < totalCost) {
            return res.status(400).json({ error: '贡献点不足' });
        }
        
        await db.run(
            'UPDATE users SET contribution = contribution - ? WHERE id = ?',
            [totalCost, req.userId]
        );
        
        await db.run(
            'UPDATE stocks SET available_shares = available_shares - ? WHERE id = ?',
            [shares, id]
        );
        
        const existingHolding = await db.get(
            'SELECT * FROM user_stocks WHERE user_id = ? AND stock_id = ?',
            [req.userId, id]
        );
        
        if (existingHolding) {
            const newShares = existingHolding.shares + shares;
            const newAvgCost = (existingHolding.shares * existingHolding.avg_cost + shares * stock.current_price) / newShares;
            await db.run(
                'UPDATE user_stocks SET shares = ?, avg_cost = ?, updated_at = ? WHERE user_id = ? AND stock_id = ?',
                [newShares, newAvgCost, getLocalTimestamp(), req.userId, id]
            );
        } else {
            await db.run(
                'INSERT INTO user_stocks (user_id, stock_id, shares, avg_cost, updated_at) VALUES (?, ?, ?, ?, ?)',
                [req.userId, id, shares, stock.current_price, getLocalTimestamp()]
            );
        }
        
        await db.run(
            'INSERT INTO stock_transactions (user_id, stock_id, type, shares, price, total_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.userId, id, 'buy', shares, stock.current_price, totalCost, getLocalTimestamp()]
        );
        
        try {
            await db.run(
                'UPDATE stock_prices SET volume = volume + ? WHERE stock_id = ? AND id = (SELECT id FROM stock_prices WHERE stock_id = ? ORDER BY recorded_at DESC LIMIT 1)',
                [shares, id, id]
            );
        } catch (e) {
            console.log('更新交易量失败，忽略');
        }
        
        res.json({ 
            message: '购买成功',
            shares,
            price: stock.current_price,
            totalCost
        });
    } catch (error) {
        console.error('购买股票错误:', error);
        res.status(500).json({ error: '购买失败' });
    }
});

router.post('/stocks/:id/sell', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { shares } = req.body;
        
        if (!shares || shares <= 0) {
            return res.status(400).json({ error: '卖出数量必须大于0' });
        }
        
        const cooldownTrade = await checkTradeCooldown(req.userId, parseInt(id), 'sell');
        if (cooldownTrade) {
            return res.status(400).json({ error: '买入后需等待1小时才能卖出该股票' });
        }
        
        const stock = await db.get('SELECT * FROM stocks WHERE id = ? AND is_active = 1', [id]);
        if (!stock) {
            return res.status(404).json({ error: '股票不存在' });
        }
        
        const maxSharesPerTrade = Math.floor(stock.total_shares * USER_TRADE_LIMIT_RATIO);
        if (shares > maxSharesPerTrade) {
            return res.status(400).json({ error: `单次交易上限为 ${maxSharesPerTrade} 股` });
        }
        
        const holding = await db.get(
            'SELECT * FROM user_stocks WHERE user_id = ? AND stock_id = ?',
            [req.userId, id]
        );
        
        if (!holding || holding.shares < shares) {
            return res.status(400).json({ error: '持有股份不足' });
        }
        
        const totalValue = Math.round(stock.current_price * shares * 100) / 100;
        
        await db.run(
            'UPDATE users SET contribution = contribution + ? WHERE id = ?',
            [totalValue, req.userId]
        );
        
        await db.run(
            'UPDATE stocks SET available_shares = available_shares + ? WHERE id = ?',
            [shares, id]
        );
        
        const newShares = holding.shares - shares;
        if (newShares > 0) {
            await db.run(
                'UPDATE user_stocks SET shares = ?, updated_at = ? WHERE user_id = ? AND stock_id = ?',
                [newShares, getLocalTimestamp(), req.userId, id]
            );
        } else {
            await db.run('DELETE FROM user_stocks WHERE user_id = ? AND stock_id = ?', [req.userId, id]);
        }
        
        await db.run(
            'INSERT INTO stock_transactions (user_id, stock_id, type, shares, price, total_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.userId, id, 'sell', shares, stock.current_price, totalValue, getLocalTimestamp()]
        );
        
        try {
            await db.run(
                'UPDATE stock_prices SET volume = volume + ? WHERE stock_id = ? AND id = (SELECT id FROM stock_prices WHERE stock_id = ? ORDER BY recorded_at DESC LIMIT 1)',
                [shares, id, id]
            );
        } catch (e) {
            console.log('更新交易量失败，忽略');
        }
        
        res.json({ 
            message: '卖出成功',
            shares,
            price: stock.current_price,
            totalValue
        });
    } catch (error) {
        console.error('卖出股票错误:', error);
        res.status(500).json({ error: '卖出失败' });
    }
});

router.get('/transactions', authMiddleware, async (req, res) => {
    try {
        const { limit = 50 } = req.query;
        
        const transactions = await db.all(
            `SELECT st.*, s.symbol, s.name 
             FROM stock_transactions st
             JOIN stocks s ON st.stock_id = s.id
             WHERE st.user_id = ?
             ORDER BY st.created_at DESC
             LIMIT ?`,
            [req.userId, parseInt(limit)]
        );
        
        res.json({ transactions });
    } catch (error) {
        console.error('获取交易记录错误:', error);
        res.status(500).json({ error: '获取交易记录失败' });
    }
});

router.post('/stocks', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { symbol, name, description, base_price, total_shares, volatility, trend } = req.body;
        
        if (!symbol || !name || !base_price) {
            return res.status(400).json({ error: '股票代码、名称和基础价格不能为空' });
        }
        
        const result = await db.run(
            'INSERT INTO stocks (symbol, name, description, base_price, current_price, total_shares, available_shares, volatility, trend) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [symbol, name, description || '', base_price, base_price, total_shares || 10000, total_shares || 10000, volatility || 0.1, trend || 0]
        );
        
        res.status(201).json({ 
            message: '股票创建成功',
            stockId: result.id
        });
    } catch (error) {
        console.error('创建股票错误:', error);
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: '股票代码已存在' });
        }
        res.status(500).json({ error: '创建股票失败' });
    }
});

router.put('/stocks/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, volatility, trend, is_active } = req.body;
        
        await db.run(
            'UPDATE stocks SET name = ?, description = ?, volatility = ?, trend = ?, is_active = ?, updated_at = ? WHERE id = ?',
            [name, description, volatility, trend, is_active ? 1 : 0, getLocalTimestamp(), id]
        );
        
        res.json({ message: '股票更新成功' });
    } catch (error) {
        console.error('更新股票错误:', error);
        res.status(500).json({ error: '更新股票失败' });
    }
});

router.post('/trigger-update', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await updateStockPrices();
        res.json({ message: '股票价格更新触发成功' });
    } catch (error) {
        console.error('触发更新错误:', error);
        res.status(500).json({ error: '触发更新失败' });
    }
});

router.post('/stocks/:id/restore', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        const stock = await db.get('SELECT * FROM stocks WHERE id = ?', [id]);
        if (!stock) {
            return res.status(404).json({ error: '股票不存在' });
        }
        
        await db.run(
            'UPDATE stocks SET is_active = 1, updated_at = ? WHERE id = ?',
            [getLocalTimestamp(), id]
        );
        
        res.json({ message: '股票已恢复', stockId: id });
    } catch (error) {
        console.error('恢复股票错误:', error);
        res.status(500).json({ error: '恢复股票失败' });
    }
});

router.delete('/stocks/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        
        const holdings = await db.all(
            'SELECT COUNT(*) as count FROM user_stocks WHERE stock_id = ? AND shares > 0',
            [id]
        );
        
        if (holdings[0].count > 0) {
            return res.status(400).json({ 
                error: `无法删除：仍有 ${holdings[0].count} 位用户持有该股票，请先恢复股票让用户卖出` 
            });
        }
        
        await db.run('DELETE FROM stocks WHERE id = ?', [id]);
        await db.run('DELETE FROM stock_prices WHERE stock_id = ?', [id]);
        await db.run('DELETE FROM stock_transactions WHERE stock_id = ?', [id]);
        
        res.json({ message: '股票已删除' });
    } catch (error) {
        console.error('删除股票错误:', error);
        res.status(500).json({ error: '删除股票失败' });
    }
});

module.exports = router;
