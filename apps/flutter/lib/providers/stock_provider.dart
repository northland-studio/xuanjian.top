import 'package:flutter/foundation.dart';
import '../models/stock.dart';
import '../models/stock_holding.dart';
import '../services/stock_service.dart';

class StockProvider extends ChangeNotifier {
  final StockService _stockService = StockService();

  List<Stock> _stocks = [];
  List<StockHolding> _holdings = [];
  bool _isLoading = false;
  bool _isLoadingPortfolio = false;
  String? _error;

  List<Stock> get stocks => _stocks;
  List<StockHolding> get holdings => _holdings;
  bool get isLoading => _isLoading;
  String? get error => _error;

  /// 获取股票列表
  Future<void> fetchStocks() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _stocks = await _stockService.fetchStocks();
    } catch (e) {
      _error = '加载股票列表失败: $e';
      _stocks = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 获取持仓信息
  Future<void> fetchPortfolio() async {
    _isLoadingPortfolio = true;
    _error = null;
    notifyListeners();

    try {
      _holdings = await _stockService.fetchPortfolio();
    } catch (e) {
      _error = '加载持仓信息失败: $e';
      _holdings = [];
    } finally {
      _isLoadingPortfolio = false;
      notifyListeners();
    }
  }

  /// 买入股票
  Future<bool> buyStock(int stockId, int shares) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await _stockService.buyStock(stockId, shares);
      // 买入后刷新持股和股票列表
      await Future.wait([fetchPortfolio(), fetchStocks()]);
      notifyListeners();
      return result;
    } catch (e) {
      _error = '买入失败: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// 卖出股票
  Future<bool> sellStock(int stockId, int shares) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await _stockService.sellStock(stockId, shares);
      await Future.wait([fetchPortfolio(), fetchStocks()]);
      notifyListeners();
      return result;
    } catch (e) {
      _error = '卖出失败: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
