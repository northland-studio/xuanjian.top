import 'package:flutter/foundation.dart';
import '../models/checkin_status.dart';
import '../services/checkin_service.dart';

class CheckinProvider extends ChangeNotifier {
  final CheckinService _checkinService = CheckinService();

  CheckinStatus? _status;
  bool _isLoading = false;
  String? _error;

  CheckinStatus? get status => _status;
  bool get isLoading => _isLoading;
  String? get error => _error;

  /// 获取打卡状态
  Future<void> fetchStatus() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _status = await _checkinService.fetchStatus();
    } catch (e) {
      _error = '加载打卡状态失败: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 执行打卡
  Future<bool> doCheckin() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _status = await _checkinService.doCheckin();
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = '打卡失败: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// 购买补签卡
  Future<bool> buyMakeupCard() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await _checkinService.buyMakeupCard();
      // 购买成功后刷新状态
      await fetchStatus();
      notifyListeners();
      return result;
    } catch (e) {
      _error = '购买补签卡失败: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// 使用补签卡补签
  Future<bool> doMakeup() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _status = await _checkinService.doMakeup();
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = '补签失败: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }
}
