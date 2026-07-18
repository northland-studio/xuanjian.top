import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/stock_provider.dart';
import '../widgets/glass_app_bar.dart';
import '../widgets/stock_item.dart';
import '../widgets/loading_screen.dart';
import '../widgets/apple_button.dart';
import '../models/stock.dart';
import '../services/stock_service.dart';
import '../config/theme.dart';

class StockScreen extends StatefulWidget {
  const StockScreen({super.key});

  @override
  State<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends State<StockScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = context.read<StockProvider>();
      provider.fetchStocks();
      provider.fetchPortfolio();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _showStockDetail(Stock stock) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _StockDetailSheet(
        stock: stock,
        onBuy: () => _showTradeDialog(stock, true),
        onSell: () => _showTradeDialog(stock, false),
      ),
    );
  }

  void _showTradeDialog(Stock stock, bool isBuy) {
    final sharesController = TextEditingController(text: '100');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isBuy ? '买入 ${stock.name}' : '卖出 ${stock.name}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('当前价格: ¥${stock.currentPrice.toStringAsFixed(2)}',
                style: Theme.of(ctx).textTheme.bodyMedium),
            const SizedBox(height: 16),
            TextField(
              controller: sharesController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: '股数',
                suffixText: '股',
                border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
            if (isBuy)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '预计花费: ¥${(int.tryParse(sharesController.text) ?? 0) * stock.currentPrice}',
                  style: Theme.of(ctx).textTheme.bodySmall,
                ),
              ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消'),
          ),
          AppleButton.primary(
            label: isBuy ? '买入' : '卖出',
            onPressed: () async {
              final shares = int.tryParse(sharesController.text) ?? 0;
              if (shares <= 0) return;
              Navigator.pop(ctx);
              final provider = context.read<StockProvider>();
              final success = isBuy
                  ? await provider.buyStock(stock.id, shares)
                  : await provider.sellStock(stock.id, shares);
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                      content:
                          Text(success ? '操作成功' : (provider.error ?? '操作失败'))),
                );
              }
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final stockProvider = context.watch<StockProvider>();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: GlassAppBar(
        title: '股票',
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: '行情'),
            Tab(text: '持仓'),
            Tab(text: '交易记录'),
          ],
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white.withAlpha(153),
          indicatorColor: Colors.white,
        ),
      ),
      body: stockProvider.isLoading
          ? const LoadingScreen()
          : TabBarView(
              controller: _tabController,
              children: [
                // 行情 tab
                _buildMarketTab(stockProvider, theme),
                // 持仓 tab
                _buildPortfolioTab(stockProvider, theme),
                // 交易记录 tab
                _TransactionHistoryTab(),
              ],
            ),
    );
  }

  Widget _buildMarketTab(StockProvider provider, ThemeData theme) {
    if (provider.stocks.isEmpty) {
      return Center(
        child: Text('暂无股票数据',
            style: theme.textTheme.bodyLarge
                ?.copyWith(color: AppleTheme.textSecondary)),
      );
    }

    return RefreshIndicator(
      onRefresh: () => provider.fetchStocks(),
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: provider.stocks.length,
        separatorBuilder: (_, __) =>
            const Divider(height: 1, indent: 16, endIndent: 16),
        itemBuilder: (context, index) {
          final stock = provider.stocks[index];
          return StockItem(
            code: stock.code,
            name: stock.name,
            currentPrice: stock.currentPrice,
            changePercent: stock.changePercent,
            onTap: () => _showStockDetail(stock),
          );
        },
      ),
    );
  }

  Widget _buildPortfolioTab(StockProvider provider, ThemeData theme) {
    if (provider.holdings.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.account_balance_wallet_outlined,
                size: 48, color: AppleTheme.textSecondary),
            const SizedBox(height: 12),
            Text('暂无持仓',
                style: theme.textTheme.bodyLarge
                    ?.copyWith(color: AppleTheme.textSecondary)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => provider.fetchPortfolio(),
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: provider.holdings.length,
        separatorBuilder: (_, __) =>
            const Divider(height: 1, indent: 16, endIndent: 16),
        itemBuilder: (context, index) {
          final h = provider.holdings[index];
          final isProfit = h.profit >= 0;
          final profitColor = isProfit
              ? const Color(0xFF34C759)
              : const Color(0xFFFF3B30);

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(h.stockName,
                          style: theme.textTheme.bodyMedium),
                      const SizedBox(height: 2),
                      Text(
                        '${h.shares}股 · 均价 ¥${h.avgPrice.toStringAsFixed(2)}',
                        style: theme.textTheme.labelSmall,
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('¥${h.currentPrice.toStringAsFixed(2)}',
                        style: theme.textTheme.bodyMedium),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          isProfit
                              ? Icons.trending_up
                              : Icons.trending_down,
                          size: 14,
                          color: profitColor,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '${isProfit ? "+" : ""}¥${h.profit.toStringAsFixed(2)}',
                          style:
                              TextStyle(fontSize: 13, color: profitColor),
                        ),
                      ],
                    ),
                    Text(
                      '${isProfit ? "+" : ""}${h.profitPercent.toStringAsFixed(2)}%',
                      style: TextStyle(fontSize: 12, color: profitColor),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _StockDetailSheet extends StatelessWidget {
  final Stock stock;
  final VoidCallback? onBuy;
  final VoidCallback? onSell;

  const _StockDetailSheet({
    required this.stock,
    this.onBuy,
    this.onSell,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isUp = stock.changePercent >= 0;
    final changeColor =
        isUp ? const Color(0xFF34C759) : const Color(0xFFFF3B30);

    return Container(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle bar
          Container(
            width: 36,
            height: 4,
            decoration: BoxDecoration(
              color: AppleTheme.textTertiary,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 20),
          // Stock info
          Text(stock.name,
              style: theme.textTheme.headlineLarge),
          const SizedBox(height: 4),
          Text(stock.code, style: theme.textTheme.bodySmall),
          const SizedBox(height: 16),
          Text(
            '¥${stock.currentPrice.toStringAsFixed(2)}',
            style: theme.textTheme.displayLarge?.copyWith(
              fontSize: 40,
              color: changeColor,
            ),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                isUp ? Icons.trending_up : Icons.trending_down,
                size: 18,
                color: changeColor,
              ),
              const SizedBox(width: 4),
              Text(
                '${isUp ? "+" : ""}${stock.changePercent.toStringAsFixed(2)}%',
                style: TextStyle(
                  fontSize: 17,
                  color: changeColor,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text('可用: ${stock.availableShares}股 · 总股本: ${stock.totalShares}股',
              style: theme.textTheme.labelSmall),
          const SizedBox(height: 20),
          // Chart placeholder
          Container(
            height: 120,
            decoration: BoxDecoration(
              color: theme.cardColor,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Center(
              child: Text('走势图 (即将上线)',
                  style: theme.textTheme.bodySmall),
            ),
          ),
          const SizedBox(height: 20),
          // Buy/Sell buttons
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    Navigator.pop(context);
                    onBuy?.call();
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF34C759),
                    side: const BorderSide(color: Color(0xFF34C759)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('买入', style: TextStyle(fontSize: 17)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    Navigator.pop(context);
                    onSell?.call();
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFFF3B30),
                    side: const BorderSide(color: Color(0xFFFF3B30)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('卖出', style: TextStyle(fontSize: 17)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

class _TransactionHistoryTab extends StatefulWidget {
  @override
  State<_TransactionHistoryTab> createState() => _TransactionHistoryTabState();
}

class _TransactionHistoryTabState extends State<_TransactionHistoryTab> {
  final StockService _stockService = StockService();
  List<Transaction> _transactions = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadTransactions();
  }

  Future<void> _loadTransactions() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final data = await _stockService.getTransactions();
      _transactions = data.map((e) => Transaction.fromJson(e)).toList();
    } catch (e) {
      _error = '加载失败: $e';
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (_isLoading) return const LoadingScreen();

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error!, style: theme.textTheme.bodySmall),
            const SizedBox(height: 12),
            TextButton(onPressed: _loadTransactions, child: const Text('重试')),
          ],
        ),
      );
    }

    if (_transactions.isEmpty) {
      return Center(
        child: Text('暂无交易记录',
            style: theme.textTheme.bodyLarge
                ?.copyWith(color: AppleTheme.textSecondary)),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadTransactions,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 8),
        itemCount: _transactions.length,
        separatorBuilder: (_, __) =>
            const Divider(height: 1, indent: 16, endIndent: 16),
        itemBuilder: (context, index) {
          final tx = _transactions[index];
          final isBuy = tx.type == 'buy';

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: isBuy
                        ? const Color(0xFF34C759).withAlpha(30)
                        : const Color(0xFFFF3B30).withAlpha(30),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Center(
                    child: Text(
                      isBuy ? '买' : '卖',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color:
                            isBuy ? const Color(0xFF34C759) : const Color(0xFFFF3B30),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(tx.stockName, style: theme.textTheme.bodyMedium),
                      const SizedBox(height: 2),
                      Text(
                        '${tx.shares}股 · ¥${tx.price.toStringAsFixed(2)}',
                        style: theme.textTheme.labelSmall,
                      ),
                    ],
                  ),
                ),
                Text(_formatTime(tx.createdAt),
                    style: theme.textTheme.labelSmall),
              ],
            ),
          );
        },
      ),
    );
  }

  String _formatTime(String timeStr) {
    if (timeStr.isEmpty) return '';
    try {
      final dt = DateTime.parse(timeStr);
      return '${dt.month}/${dt.day} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return timeStr;
    }
  }
}
