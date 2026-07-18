import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user.dart';
import 'api_client.dart';

class AuthService {
  final _dio = ApiClient().dio;

  Future<Map<String, dynamic>> login(String username, String password, {bool remember = false}) async {
    final response = await _dio.post('/api/auth/login', data: {
      'username': username, 'password': password, 'remember': remember,
    });
    final data = response.data;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('token', data['token']);
    await prefs.setString('user', jsonEncode(data['user']));
    return data;
  }

  Future<Map<String, dynamic>> register(String username, String password, String email, {String? code}) async {
    final response = await _dio.post('/api/auth/register', data: {
      'username': username, 'password': password, 'email': email, if (code != null) 'code': code,
    });
    final data = response.data;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('token', data['token']);
    await prefs.setString('user', jsonEncode(data['user']));
    return data;
  }

  Future<void> sendCode(String email) async {
    await _dio.post('/api/auth/send-code', data: {'email': email});
  }

  Future<Map<String, dynamic>> updateProfile(Map<String, dynamic> data) async {
    final response = await _dio.put('/api/auth/profile', data: data);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user', jsonEncode(response.data));
    return response.data;
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    await prefs.remove('user');
  }

  Future<User?> getMe() async {
    try {
      final response = await _dio.get('/api/auth/me');
      return User.fromJson(response.data);
    } catch (_) {
      return null;
    }
  }

  User? getCurrentUser() {
    // This is a sync helper - the actual state is managed by AuthProvider
    return null;
  }

  Future<bool> isLoggedIn() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('token') != null;
  }

  Future<void> forgotPassword(String email) async {
    await _dio.post('/api/password/forgot-password', data: {'email': email});
  }

  Future<void> resetPassword(String token, String newPassword) async {
    await _dio.post('/api/password/reset-password', data: {
      'token': token, 'password': newPassword,
    });
  }
}
