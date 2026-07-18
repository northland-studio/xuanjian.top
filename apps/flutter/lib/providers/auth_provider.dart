import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user.dart';
import '../services/auth_service.dart';

class AuthProvider extends ChangeNotifier {
  final AuthService _authService = AuthService();

  User? _user;
  String? _token;
  bool _isLoading = false;
  String? _error;

  User? get user => _user;
  String? get token => _token;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isLoggedIn => _user != null && _token != null;

  static const _keyToken = 'auth_token';
  static const _keyUsername = 'auth_username';

  /// 初始化时从 SharedPreferences 加载已保存的用户信息
  Future<void> loadSavedUser() async {
    _isLoading = true;
    notifyListeners();

    try {
      final prefs = await SharedPreferences.getInstance();
      _token = prefs.getString(_keyToken);

      if (_token != null && _token!.isNotEmpty) {
        try {
          _user = await _authService.fetchMe(_token!);
        } catch (e) {
          // token 可能已过期，清除本地数据
          await _clearSavedUser(prefs);
        }
      }
    } catch (e) {
      _error = '加载用户信息失败: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 登录
  /// [remember] 为 true 时将 token 持久化到 SharedPreferences
  Future<bool> login(String username, String password, {bool remember = false}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final authResponse = await _authService.login(username, password);
      _token = authResponse.token;
      _user = authResponse.user;

      if (remember) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_keyToken, _token!);
        await prefs.setString(_keyUsername, username);
      }

      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = '登录失败: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// 登出
  Future<void> logout() async {
    _user = null;
    _token = null;
    _error = null;

    final prefs = await SharedPreferences.getInstance();
    await _clearSavedUser(prefs);

    notifyListeners();
  }

  /// 获取当前用户完整信息
  Future<void> fetchMe() async {
    if (_token == null) return;

    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _user = await _authService.fetchMe(_token!);
    } catch (e) {
      _error = '获取用户信息失败: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> _clearSavedUser(SharedPreferences prefs) async {
    await prefs.remove(_keyToken);
    await prefs.remove(_keyUsername);
    _token = null;
    _user = null;
  }
}
