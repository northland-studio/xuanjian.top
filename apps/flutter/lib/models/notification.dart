class AppNotification {
  final int id;
  final String type; // comment, like, system, announcement
  final String title;
  final String content;
  final int? postId;
  final bool isRead;
  final String createdAt;

  AppNotification({required this.id, required this.type, required this.title, required this.content, this.postId, this.isRead = false, required this.createdAt});

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
    id: json['id'] ?? 0,
    type: json['type'] ?? '',
    title: json['title'] ?? '',
    content: json['content'] ?? json['message'] ?? '',
    postId: json['post_id'],
    isRead: json['is_read'] == 1 || json['is_read'] == true || json['read'] == 1 || json['read'] == true,
    createdAt: json['created_at'] ?? '',
  );
}
