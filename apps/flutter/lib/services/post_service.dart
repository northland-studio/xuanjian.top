import 'package:dio/dio.dart';
import '../models/post.dart';
import 'api_client.dart';

class PostService {
  final _dio = ApiClient().dio;

  Future<List<Post>> getPosts({String? type, int page = 1, int limit = 20}) async {
    final response = await _dio.get('/api/posts', queryParameters: {
      if (type != null && type != 'all') 'type': type,
      'page': page, 'limit': limit,
    });
    final list = response.data['posts'] as List? ?? response.data as List;
    return list.map((e) => Post.fromJson(e)).toList();
  }

  Future<Post> getPost(int id) async {
    final response = await _dio.get('/api/posts/$id');
    return Post.fromJson(response.data);
  }

  Future<Post> createPost({required String title, required String content, required String type}) async {
    final response = await _dio.post('/api/posts', data: {
      'title': title, 'content': content, 'type': type,
    });
    return Post.fromJson(response.data);
  }

  Future<Post> updatePost(int id, {required String title, required String content}) async {
    final response = await _dio.put('/api/posts/$id', data: {
      'title': title, 'content': content,
    });
    return Post.fromJson(response.data);
  }

  Future<void> deletePost(int id) async {
    await _dio.delete('/api/posts/$id');
  }

  Future<void> likePost(int id) async {
    await _dio.post('/api/posts/$id/like');
  }

  Future<Map<String, dynamic>> addComment(int postId, String content, {int? parentId}) async {
    final response = await _dio.post('/api/posts/$postId/comments', data: {
      'content': content, if (parentId != null) 'parent_id': parentId,
    });
    return response.data;
  }

  Future<Map<String, dynamic>> getPublicStats() async {
    final response = await _dio.get('/api/posts/public-stats');
    return response.data;
  }
}
