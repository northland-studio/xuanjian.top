import 'package:flutter/foundation.dart';
import '../models/post.dart';
import '../services/post_service.dart';

class PostProvider extends ChangeNotifier {
  final PostService _postService = PostService();

  List<Post> _posts = [];
  Post? _currentPost;
  bool _isLoading = false;
  bool _isLoadingDetail = false;
  String? _error;

  List<Post> get posts => _posts;
  Post? get currentPost => _currentPost;
  bool get isLoading => _isLoading;
  bool get isLoadingDetail => _isLoadingDetail;
  String? get error => _error;

  /// 获取帖子列表
  /// [type] 为 'daily' | 'decision' | 'forum'
  Future<void> fetchPosts(String type) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _posts = await _postService.fetchPosts(type);
    } catch (e) {
      _error = '加载帖子列表失败: $e';
      _posts = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// 获取帖子详情
  Future<void> fetchPostDetail(int id) async {
    _isLoadingDetail = true;
    notifyListeners();

    try {
      _currentPost = await _postService.fetchPostDetail(id);
    } catch (e) {
      _error = '加载帖子详情失败: $e';
    } finally {
      _isLoadingDetail = false;
      notifyListeners();
    }
  }

  /// 创建帖子
  Future<bool> createPost(String title, String content, String type) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final post = await _postService.createPost(title, content, type);
      _posts.insert(0, post);
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = '创建帖子失败: $e';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  /// 删除帖子
  Future<bool> deletePost(int id) async {
    _error = null;
    notifyListeners();

    try {
      await _postService.deletePost(id);
      _posts.removeWhere((p) => p.id == id);
      if (_currentPost?.id == id) {
        _currentPost = null;
      }
      notifyListeners();
      return true;
    } catch (e) {
      _error = '删除帖子失败: $e';
      notifyListeners();
      return false;
    }
  }

  /// 点赞/取消点赞帖子
  Future<void> likePost(int id) async {
    try {
      final updatedPost = await _postService.likePost(id);

      final index = _posts.indexWhere((p) => p.id == id);
      if (index != -1) {
        _posts[index] = updatedPost;
      }
      if (_currentPost?.id == id) {
        _currentPost = updatedPost;
      }
      notifyListeners();
    } catch (e) {
      _error = '操作失败: $e';
      notifyListeners();
    }
  }
}
