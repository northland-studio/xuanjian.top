class Post {
  final int id;
  final String title;
  final String content;
  final String type; // daily, decision, forum
  final int authorId;
  final String authorName;
  final String? authorAvatar;
  final int views;
  final int likes;
  final int comments;
  final String? status;
  final String createdAt;
  final String? updatedAt;
  final bool isLiked;

  Post({required this.id, required this.title, required this.content, required this.type, required this.authorId, required this.authorName, this.authorAvatar, this.views = 0, this.likes = 0, this.comments = 0, this.status, required this.createdAt, this.updatedAt, this.isLiked = false});

  factory Post.fromJson(Map<String, dynamic> json) => Post(
    id: json['id'] ?? 0,
    title: json['title'] ?? '',
    content: json['content'] ?? '',
    type: json['type'] ?? 'forum',
    authorId: json['author_id'] ?? 0,
    authorName: json['author'] ?? json['username'] ?? '',
    authorAvatar: json['author_avatar'],
    views: json['views'] ?? 0,
    likes: json['likes'] ?? 0,
    comments: json['comments'] ?? json['comment_count'] ?? 0,
    status: json['status'],
    createdAt: json['created_at'] ?? '',
    updatedAt: json['updated_at'],
    isLiked: json['is_liked'] == 1 || json['is_liked'] == true,
  );
}
