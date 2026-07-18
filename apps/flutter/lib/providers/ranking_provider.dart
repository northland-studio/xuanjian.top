import 'package:flutter/foundation.dart';
import '../models/ranking_user.dart';
import '../services/ranking_service.dart';

class RankingProvider extends ChangeNotifier {
  final RankingService _rankingService = RankingService();

  List<RankingUser> _rankings = [];
  String _currentType = 'contribution';
  bool _isLoading = false;
  String? _error;

  List<RankingUser> get rankings => _rankings;
  String get currentType => _currentType;
  bool get isLoading => _isLoading;
  String? get error => _error;

  /// 获取排行榜
  /// [type] 为 'contribution' | 'posts_views' | 'posts_likes' | 'checkin' | 'stock'
  Future<void> fetchRankings(String type) async {
    _currentType = type;
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _rankings = await _rankingService.fetchRankings(type);
    } catch (e) {
      _error = '加载排行榜失败: $e';
      _rankings = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }
}
