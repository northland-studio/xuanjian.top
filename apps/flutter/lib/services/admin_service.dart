import 'api_client.dart';

class AdminService {
  final _dio = ApiClient().dio;

  Future<Map<String, dynamic>> getStats() async {
    final response = await _dio.get('/api/admin/stats');
    return response.data;
  }

  Future<List<Map<String, dynamic>>> getUsers({int page = 1, int limit = 20, String? search}) async {
    final response = await _dio.get('/api/admin/users', queryParameters: {
      'page': page, 'limit': limit,
      if (search != null) 'search': search,
    });
    final list = response.data['users'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> updateUser(int userId, Map<String, dynamic> data) async {
    final response = await _dio.put('/api/admin/users/$userId', data: data);
    return response.data;
  }

  Future<void> deleteUser(int userId) async {
    await _dio.delete('/api/admin/users/$userId');
  }

  Future<List<Map<String, dynamic>>> getPosts({int page = 1, int limit = 20, String? search}) async {
    final response = await _dio.get('/api/admin/posts', queryParameters: {
      'page': page, 'limit': limit,
      if (search != null) 'search': search,
    });
    final list = response.data['posts'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<void> deletePost(int postId) async {
    await _dio.delete('/api/admin/posts/$postId');
  }

  Future<List<Map<String, dynamic>>> getAnnouncements({int page = 1, int limit = 20}) async {
    final response = await _dio.get('/api/admin/announcements', queryParameters: {
      'page': page, 'limit': limit,
    });
    final list = response.data['announcements'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> createAnnouncement(String title, String content) async {
    final response = await _dio.post('/api/admin/announcements', data: {
      'title': title, 'content': content,
    });
    return response.data;
  }

  Future<Map<String, dynamic>> updateAnnouncement(int id, {required String title, required String content}) async {
    final response = await _dio.put('/api/admin/announcements/$id', data: {
      'title': title, 'content': content,
    });
    return response.data;
  }

  Future<void> deleteAnnouncement(int id) async {
    await _dio.delete('/api/admin/announcements/$id');
  }

  Future<Map<String, dynamic>> getTheme() async {
    final response = await _dio.get('/api/admin/theme');
    return response.data;
  }

  Future<Map<String, dynamic>> updateTheme(Map<String, dynamic> data) async {
    final response = await _dio.put('/api/admin/theme', data: data);
    return response.data;
  }
}
