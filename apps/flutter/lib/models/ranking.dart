class RankingUser {
  final int rank;
  final int userId;
  final String username;
  final int value;
  final String? title;
  final String? titleColor;

  RankingUser({required this.rank, required this.userId, required this.username, required this.value, this.title, this.titleColor});

  factory RankingUser.fromJson(Map<String, dynamic> json) => RankingUser(
    rank: json['rank'] ?? 0,
    userId: json['user_id'] ?? json['id'] ?? 0,
    username: json['username'] ?? '',
    value: json['value'] ?? json['contribution'] ?? json['views'] ?? json['likes'] ?? 0,
    title: json['title'],
    titleColor: json['title_color'],
  );
}
