import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/notification_provider.dart';
import '../widgets/glass_app_bar.dart';
import '../widgets/loading_screen.dart';
import '../models/notification.dart';
import '../config/theme.dart';
import 'post_detail_screen.dart';

class NotificationScreen extends StatefulWidget {
  const NotificationScreen({super.key});

  @override
  State<NotificationScreen> createState() => _NotificationScreenState();
}

class _NotificationScreenState extends State<NotificationScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<NotificationProvider>().fetchNotifications();
    });
  }

  Future<void> _markAllRead() async {
    await context.read<NotificationProvider>().markAllRead();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已全部标记为已读')),
      );
    }
  }

  void _onTapNotification(AppNotification notification) {
    final provider = context.read<NotificationProvider>();
    if (!notification.isRead) {
      provider.markRead(notification.id);
    }
    if (notification.postId != null) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) =>
              PostDetailScreen(postId: notification.postId!),
        ),
      );
    }
  }

  IconData _iconForType(String type) {
    switch (type) {
      case 'comment':
        return Icons.chat;
      case 'like':
        return Icons.favorite;
      case 'system':
        return Icons.info;
      case 'announcement':
        return Icons.campaign;
      default:
        return Icons.notifications;
    }
  }

  Color _colorForType(String type) {
    switch (type) {
      case 'comment':
        return AppleTheme.appleBlue;
      case 'like':
        return Colors.red;
      case 'system':
        return const Color(0xFF34C759);
      case 'announcement':
        return const Color(0xFFFF9500);
      default:
        return AppleTheme.textSecondary;
    }
  }

  String _timeAgo(String timeStr) {
    if (timeStr.isEmpty) return '';
    try {
      final dt = DateTime.parse(timeStr);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return '刚刚';
      if (diff.inMinutes < 60) return '${diff.inMinutes}分钟前';
      if (diff.inHours < 24) return '${diff.inHours}小时前';
      if (diff.inDays < 7) return '${diff.inDays}天前';
      return '${dt.month}/${dt.day}';
    } catch (_) {
      return timeStr;
    }
  }

  @override
  Widget build(BuildContext context) {
    final notificationProvider = context.watch<NotificationProvider>();
    final notifications = notificationProvider.notifications;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: GlassAppBar(
        title: '通知',
        actions: [
          if (notifications.any((n) => !n.isRead))
            TextButton(
              onPressed: _markAllRead,
              child: const Text('全部已读',
                  style: TextStyle(color: Colors.white, fontSize: 14)),
            ),
        ],
      ),
      body: notificationProvider.isLoading
          ? const LoadingScreen()
          : notifications.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.notifications_none,
                          size: 56, color: AppleTheme.textTertiary),
                      const SizedBox(height: 16),
                      Text('暂无通知',
                          style: theme.textTheme.bodyLarge?.copyWith(
                              color: AppleTheme.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () =>
                      notificationProvider.fetchNotifications(),
                  child: ListView.separated(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    itemCount: notifications.length,
                    separatorBuilder: (_, __) =>
                        const Divider(height: 1, indent: 64, endIndent: 16),
                    itemBuilder: (context, index) {
                      final notification = notifications[index];
                      final typeColor = _colorForType(notification.type);

                      return InkWell(
                        onTap: () =>
                            _onTapNotification(notification),
                        child: Container(
                          color: notification.isRead
                              ? Colors.transparent
                              : AppleTheme.appleBlue.withAlpha(10),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 12),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Icon
                              Container(
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(
                                  color: typeColor.withAlpha(30),
                                  borderRadius:
                                      BorderRadius.circular(20),
                                ),
                                child: Icon(
                                  _iconForType(notification.type),
                                  size: 20,
                                  color: typeColor,
                                ),
                              ),
                              const SizedBox(width: 12),
                              // Content
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            notification.title,
                                            style: theme
                                                .textTheme.bodyMedium
                                                ?.copyWith(
                                              fontWeight:
                                                  notification.isRead
                                                      ? FontWeight.w400
                                                      : FontWeight.w700,
                                            ),
                                            maxLines: 1,
                                            overflow:
                                                TextOverflow.ellipsis,
                                          ),
                                        ),
                                        if (!notification.isRead)
                                          Container(
                                            width: 8,
                                            height: 8,
                                            decoration:
                                                const BoxDecoration(
                                              color:
                                                  AppleTheme.appleBlue,
                                              shape: BoxShape.circle,
                                            ),
                                          ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      notification.content,
                                      style:
                                          theme.textTheme.bodySmall,
                                      maxLines: 2,
                                      overflow:
                                          TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      _timeAgo(
                                          notification.createdAt),
                                      style: theme
                                          .textTheme.labelSmall,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
