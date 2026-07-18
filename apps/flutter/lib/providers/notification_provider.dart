import 'package:flutter/foundation.dart';
import '../models/app_notification.dart';
import '../services/notification_service.dart';

class NotificationProvider extends ChangeNotifier {
  final NotificationService _notificationService = NotificationService();

  List<AppNotification> _notifications = [];
  int _unreadCount = 0;
  bool _isLoading = false;
  String? _error;

  List<AppNotification> get notifications => _notifications;
  int get unreadCount => _unreadCount;
  bool get isLoading => _isLoading;
  String? get error => _error;

  /// 获取通知列表
  Future<void> fetchNotifications() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _notifications = await _notificationService.fetchNotifications();
      _unreadCount = _notifications.where((n) => !n.isRead).length;
    } catch (e) {
      _error = '加载通知列表失败: $e';
      _notifications = [];
      _unreadCount = 0;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 标记单条通知为已读
  Future<void> markRead(int id) async {
    try {
      await _notificationService.markRead(id);

      final index = _notifications.indexWhere((n) => n.id == id);
      if (index != -1) {
        _notifications[index].isRead = true;
        _unreadCount = _notifications.where((n) => !n.isRead).length;
      }
      notifyListeners();
    } catch (e) {
      _error = '标记已读失败: $e';
      notifyListeners();
    }
  }

  /// 全部标记为已读
  Future<void> markAllRead() async {
    try {
      await _notificationService.markAllRead();

      for (final n in _notifications) {
        n.isRead = true;
      }
      _unreadCount = 0;
      notifyListeners();
    } catch (e) {
      _error = '标记全部已读失败: $e';
      notifyListeners();
    }
  }

  /// 删除通知
  Future<void> deleteNotification(int id) async {
    try {
      await _notificationService.deleteNotification(id);

      _notifications.removeWhere((n) => n.id == id);
      _unreadCount = _notifications.where((n) => !n.isRead).length;
      notifyListeners();
    } catch (e) {
      _error = '删除通知失败: $e';
      notifyListeners();
    }
  }
}
