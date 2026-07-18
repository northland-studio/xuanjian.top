import 'api_client.dart';

class StockService {
  final _dio = ApiClient().dio;

  Future<List<Map<String, dynamic>>> getStocks({String? type, int page = 1, int limit = 20}) async {
    final response = await _dio.get('/api/stock/stocks', queryParameters: {
      if (type != null) 'type': type,
      'page': page, 'limit': limit,
    });
    final list = response.data['stocks'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> getStock(int id) async {
    final response = await _dio.get('/api/stock/stocks/$id');
    return response.data;
  }

  Future<List<Map<String, dynamic>>> getPortfolio() async {
    final response = await _dio.get('/api/stock/portfolio');
    final list = response.data['portfolio'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<Map<String, dynamic>> buyStock(int stockId, int quantity) async {
    final response = await _dio.post('/api/stock/transactions', data: {
      'stock_id': stockId, 'quantity': quantity, 'type': 'buy',
    });
    return response.data;
  }

  Future<Map<String, dynamic>> sellStock(int stockId, int quantity) async {
    final response = await _dio.post('/api/stock/transactions', data: {
      'stock_id': stockId, 'quantity': quantity, 'type': 'sell',
    });
    return response.data;
  }

  Future<List<Map<String, dynamic>>> getTransactions({int page = 1, int limit = 20}) async {
    final response = await _dio.get('/api/stock/transactions', queryParameters: {
      'page': page, 'limit': limit,
    });
    final list = response.data['transactions'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }

  Future<void> triggerUpdate() async {
    await _dio.post('/api/stock/trigger-update');
  }
}
