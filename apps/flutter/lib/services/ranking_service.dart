import 'api_client.dart';

class RankingService {
  final _dio = ApiClient().dio;

  Future<List<Map<String, dynamic>>> getRankings({String? type, int page = 1, int limit = 20}) async {
    final response = await _dio.get('/api/rankings', queryParameters: {
      if (type != null) 'type': type,
      'page': page, 'limit': limit,
    });
    final list = response.data['rankings'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }
}
