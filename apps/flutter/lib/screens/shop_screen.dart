import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/shop_provider.dart';
import '../widgets/glass_app_bar.dart';
import '../widgets/loading_screen.dart';
import '../widgets/apple_button.dart';
import '../models/shop.dart';
import '../config/theme.dart';

class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key});

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = context.read<ShopProvider>();
      provider.fetchItems();
      provider.fetchMyItems();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _buyItem(ShopItem item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('购买 ${item.name}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('价格: ${item.price} 贡献点',
                style: Theme.of(ctx).textTheme.bodyLarge),
            if (item.description != null) ...[
              const SizedBox(height: 8),
              Text(item.description!,
                  style: Theme.of(ctx).textTheme.bodySmall),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          AppleButton.primary(
            label: '确认购买',
            onPressed: () => Navigator.pop(ctx, true),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final provider = context.read<ShopProvider>();
      final success = await provider.buyItem(item.id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content:
                  Text(success ? '购买成功！' : (provider.error ?? '购买失败'))),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final shopProvider = context.watch<ShopProvider>();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: GlassAppBar(
        title: '商店',
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: '商品'),
            Tab(text: '我的道具'),
          ],
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white.withAlpha(153),
          indicatorColor: Colors.white,
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // 商品 tab
          shopProvider.isLoading
              ? const LoadingScreen()
              : shopProvider.items.isEmpty
                  ? Center(
                      child: Text('暂无商品',
                          style: theme.textTheme.bodyLarge?.copyWith(
                              color: AppleTheme.textSecondary)),
                    )
                  : RefreshIndicator(
                      onRefresh: () => shopProvider.fetchItems(),
                      child: GridView.builder(
                        padding: const EdgeInsets.all(12),
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          childAspectRatio: 0.75,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                        ),
                        itemCount: shopProvider.items.length,
                        itemBuilder: (context, index) {
                          final item = shopProvider.items[index];
                          return _ShopItemCard(
                            item: item,
                            onBuy: () => _buyItem(item),
                          );
                        },
                      ),
                    ),
          // 我的道具 tab
          shopProvider.myItems.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.inventory_2_outlined,
                          size: 48, color: AppleTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text('暂无道具',
                          style: theme.textTheme.bodyLarge?.copyWith(
                              color: AppleTheme.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () => shopProvider.fetchMyItems(),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: shopProvider.myItems.length,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final myItem = shopProvider.myItems[index];
                      return _MyItemCard(item: myItem);
                    },
                  ),
                ),
        ],
      ),
    );
  }
}

class _ShopItemCard extends StatelessWidget {
  final ShopItem item;
  final VoidCallback onBuy;

  const _ShopItemCard({required this.item, required this.onBuy});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      color: theme.cardColor,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: item.stock > 0 ? onBuy : null,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Image placeholder
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: AppleTheme.lightGray,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(
                    child: Icon(
                      item.type == 'title'
                          ? Icons.card_membership
                          : Icons.card_giftcard,
                      size: 40,
                      color: AppleTheme.textTertiary,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Text(item.name,
                  style: theme.textTheme.bodyMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.monetization_on,
                          size: 14,
                          color: Color(0xFFFF9500)),
                      const SizedBox(width: 2),
                      Text('${item.price}',
                          style: const TextStyle(
                            fontSize: 13,
                            color: Color(0xFFFF9500),
                            fontWeight: FontWeight.w600,
                          )),
                    ],
                  ),
                  Text(
                    item.stock > 0 ? '有货' : '售罄',
                    style: TextStyle(
                      fontSize: 12,
                      color: item.stock > 0
                          ? AppleTheme.appleBlue
                          : AppleTheme.textTertiary,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MyItemCard extends StatelessWidget {
  final UserItem item;

  const _MyItemCard({required this.item});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppleTheme.lightGray,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Center(
              child: Icon(
                item.itemType == 'title'
                    ? Icons.card_membership
                    : Icons.card_giftcard,
                size: 22,
                color: AppleTheme.appleBlue,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.itemName, style: theme.textTheme.bodyMedium),
                if (item.verifyCode != null) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.vpn_key,
                          size: 14, color: AppleTheme.textSecondary),
                      const SizedBox(width: 4),
                      Text('核销码: ${item.verifyCode}',
                          style: theme.textTheme.labelSmall),
                    ],
                  ),
                ],
              ],
            ),
          ),
          Icon(
            item.isVerified
                ? Icons.check_circle
                : Icons.check_circle_outline,
            size: 22,
            color: item.isVerified
                ? const Color(0xFF34C759)
                : AppleTheme.textTertiary,
          ),
        ],
      ),
    );
  }
}
