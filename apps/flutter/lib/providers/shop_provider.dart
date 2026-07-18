import 'package:flutter/foundation.dart';
import '../models/shop_item.dart';
import '../models/user_item.dart';
import '../services/shop_service.dart';

class ShopProvider extends ChangeNotifier {
  final ShopService _shopService = ShopService();

  List<ShopItem> _items = [];
  List<UserItem> _myItems = [];
  bool _isLoading = false;
  bool _isLoadingMyItems = false;
  String? _error;

  List<ShopItem> get items => _items;
  List<UserItem> get myItems => _myItems;
  bool get isLoading => _isLoading;
  String? get error => _error;

  /// 获取商店商品列表
  Future<void> fetchItems() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _items = await _shopService.fetchItems();
    } catch (e) {
      _error = '加载商品列表失败: $e';
      _items = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 获取我已购买的道具
  Future<void> fetchMyItems() async {
    _isLoadingMyItems = true;
    _error = null;
    notifyListeners();

    try {
      _myItems = await _shopService.fetchMyItems();
    } catch (e) {
      _error = '加载我的道具失败: $e';
      _myItems = [];
    } finally {
      _isLoadingMyItems = false;
      notifyListeners();
    }
  }

  /// 购买道具
  Future<bool> buyItem(int id) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      await _shopService.buyItem(id);
      // 购买成功后刷新商品列表和我的道具
      await Future.wait([fetchItems(), fetchMyItems()]);
      notifyListeners();
      return true;
    } catch (e) {
      _error = '购买失败: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
