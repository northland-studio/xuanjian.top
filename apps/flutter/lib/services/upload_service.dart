import 'dart:io';
import 'package:dio/dio.dart';
import 'api_client.dart';

class UploadService {
  final _dio = ApiClient().dio;

  Future<Map<String, dynamic>> uploadImage(File file) async {
    final formData = FormData.fromMap({
      'image': await MultipartFile.fromFile(file.path),
    });
    final response = await _dio.post('/api/upload/image', data: formData);
    return response.data;
  }

  Future<List<Map<String, dynamic>>> uploadImages(List<File> files) async {
    final formData = FormData();
    for (final file in files) {
      formData.files.addAll([
        MapEntry('images', await MultipartFile.fromFile(file.path)),
      ]);
    }
    final response = await _dio.post('/api/upload/images', data: formData);
    final list = response.data['images'] as List? ?? response.data as List;
    return list.cast<Map<String, dynamic>>();
  }
}
