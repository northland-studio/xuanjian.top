import 'api_client.dart';

class NotificationService {
  final _dio = ApiClient().dio;

  Future<List<Map<String, dynamic>>> getNotifications({int page = 1, int limit = 20}) async {
    final response = await _dio.get('/api/notifications', queryParameters: {
      'page': page, 'limit': limit,
    });
    final list = response.data['notifications'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> markAsRead(int id) async {
    final response = await _dio.put('/api/notifications/$id/read');
    return response.data;
  }

  Future<void> markAllAsRead() async {
    await _dio.put('/api/notifications/read-all');
  }

  Future<int> getUnreadCount() async {
    final response = await _dio.get('/api/notifications/unread-count');
    return response.data['count'] as int;
  }
}
