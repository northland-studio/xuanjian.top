import 'package:flutter/material.dart';
import 'package:xuanjian_guild/config/theme.dart';
import 'package:xuanjian_guild/models/post.dart';

class PostCard extends StatelessWidget {
  final Post post;
  final VoidCallback? onTap;

  const PostCard({
    Key? key,
    required this.post,
    this.onTap,
  }) : super(key: key);

  Color _typeBadgeColor() {
    switch (post.type) {
      case 'daily':
        return AppleTheme.appleBlue;
      case 'decision':
        return const Color(0xFFF96300); // orange
      case 'forum':
        return const Color(0xFFAF52DE); // purple
      default:
        return AppleTheme.textSecondary;
    }
  }

  String _typeBadgeLabel() {
    switch (post.type) {
      case 'daily':
        return '日常';
      case 'decision':
        return '决议';
      case 'forum':
        return '论坛';
      default:
        return post.type;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      color: AppleTheme.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      post.authorName,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: AppleTheme.textSecondary,
                      ),
                    ),
                  ),
                  Text(
                    _formatTime(post.createdAt),
                    style: theme.textTheme.labelSmall,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                post.title,
                style: theme.textTheme.headlineMedium,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 6),
              Text(
                post.content,
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: AppleTheme.textSecondary,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Chip(
                    label: Text(
                      _typeBadgeLabel(),
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.white,
                      ),
                    ),
                    backgroundColor: _typeBadgeColor(),
                    padding: EdgeInsets.zero,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                  ),
                  const Spacer(),
                  _StatIcon(
                    icon: Icons.favorite_border,
                    label: '${post.likes}',
                  ),
                  const SizedBox(width: 12),
                  _StatIcon(
                    icon: Icons.chat_bubble_outline,
                    label: '${post.comments}',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatTime(String createdAt) {
    if (createdAt.isEmpty) return '';
    try {
      final dt = DateTime.parse(createdAt);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return '刚刚';
      if (diff.inMinutes < 60) return '${diff.inMinutes}分钟前';
      if (diff.inHours < 24) return '${diff.inHours}小时前';
      if (diff.inDays < 30) return '${diff.inDays}天前';
      return '${dt.month}/${dt.day}';
    } catch (_) {
      return createdAt;
    }
  }
}

class _StatIcon extends StatelessWidget {
  final IconData icon;
  final String label;

  const _StatIcon({
    required this.icon,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          icon,
          size: 16,
          color: AppleTheme.textSecondary,
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(
            fontSize: 13,
            color: AppleTheme.textSecondary,
          ),
        ),
      ],
    );
  }
}
