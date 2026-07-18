import 'package:flutter/material.dart';
import 'package:xuanjian_guild/config/theme.dart';

class StockItem extends StatelessWidget {
  final String code;
  final String name;
  final double currentPrice;
  final double changePercent;
  final VoidCallback? onTap;

  const StockItem({
    Key? key,
    required this.code,
    required this.name,
    required this.currentPrice,
    required this.changePercent,
    this.onTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bool isUp = changePercent >= 0;
    final Color changeColor = isUp ? const Color(0xFF34C759) : const Color(0xFFFF3B30);

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Text(
              code,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                name,
                style: theme.textTheme.bodyLarge,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  currentPrice.toStringAsFixed(2),
                  style: theme.textTheme.titleMedium,
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isUp ? Icons.trending_up : Icons.trending_down,
                      size: 16,
                      color: changeColor,
                    ),
                    const SizedBox(width: 2),
                    Text(
                      '${isUp ? "+" : ""}${changePercent.toStringAsFixed(2)}%',
                      style: TextStyle(
                        fontSize: 13,
                        color: changeColor,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
