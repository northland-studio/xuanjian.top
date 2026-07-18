class User {
  final int id;
  final String username;
  final int level;
  final int? titleId;
  final String? titleName;
  final String? titleColor;
  final int contribution;
  final bool emailVerified;
  final String? createdAt;

  User({required this.id, required this.username, required this.level, this.titleId, this.titleName, this.titleColor, this.contribution = 0, this.emailVerified = false, this.createdAt});

  factory User.fromJson(Map<String, dynamic> json) => User(
    id: json['id'] ?? 0,
    username: json['username'] ?? '',
    level: json['level'] ?? 0,
    titleId: json['title_id'],
    titleName: json['title'],
    titleColor: json['title_color'],
    contribution: json['contribution'] ?? 0,
    emailVerified: json['email_verified'] == 1 || json['email_verified'] == true,
    createdAt: json['created_at'],
  );

  Map<String, dynamic> toJson() => {'id': id, 'username': username, 'level': level, 'title_id': titleId, 'title': titleName, 'title_color': titleColor, 'contribution': contribution, 'email_verified': emailVerified, 'created_at': createdAt};
}
