import 'api_client.dart';

class CheckinService {
  final _dio = ApiClient().dio;

  Future<Map<String, dynamic>> getCheckinStatus() async {
    final response = await _dio.get('/api/checkin/status');
    return response.data;
  }

  Future<Map<String, dynamic>> checkin() async {
    final response = await _dio.post('/api/checkin/checkin');
    return response.data;
  }

  Future<Map<String, dynamic>> makeupCheckin() async {
    final response = await _dio.post('/api/checkin/makeup');
    return response.data;
  }

  Future<Map<String, dynamic>> buyMakeupCard() async {
    final response = await _dio.post('/api/checkin/buy-makeup-card');
    return response.data;
  }

  Future<List<Map<String, dynamic>>> getRewards() async {
    final response = await _dio.get('/api/checkin/rewards');
    final list = response.data['rewards'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<List<Map<String, dynamic>>> getRanking({int page = 1, int limit = 20}) async {
    final response = await _dio.get('/api/checkin/ranking', queryParameters: {
      'page': page, 'limit': limit,
    });
    final list = response.data['ranking'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }
}
