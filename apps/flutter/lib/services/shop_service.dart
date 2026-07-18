import 'api_client.dart';

class ShopService {
  final _dio = ApiClient().dio;

  Future<List<Map<String, dynamic>>> getItems({String? category, int page = 1, int limit = 20}) async {
    final response = await _dio.get('/api/shop/items', queryParameters: {
      if (category != null) 'category': category,
      'page': page, 'limit': limit,
    });
    final list = response.data['items'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> getItem(int id) async {
    final response = await _dio.get('/api/shop/items/$id');
    return response.data;
  }

  Future<Map<String, dynamic>> buyItem(int itemId, {int quantity = 1}) async {
    final response = await _dio.post('/api/shop/items/$itemId/buy', data: {
      'quantity': quantity,
    });
    return response.data;
  }

  Future<List<Map<String, dynamic>>> getMyItems() async {
    final response = await _dio.get('/api/shop/my-items');
    final list = response.data['items'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> useItem(int itemId) async {
    final response = await _dio.post('/api/shop/my-items/$itemId/use');
    return response.data;
  }
}
