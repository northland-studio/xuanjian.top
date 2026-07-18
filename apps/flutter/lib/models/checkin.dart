class CheckinStatus {
  final bool canCheckin;
  final int totalDays;
  final int currentStreak;
  final bool hasMakeupCard;
  final int contribution;

  CheckinStatus({this.canCheckin = true, this.totalDays = 0, this.currentStreak = 0, this.hasMakeupCard = false, this.contribution = 0});

  factory CheckinStatus.fromJson(Map<String, dynamic> json) => CheckinStatus(
    canCheckin: json['can_checkin'] != false,
    totalDays: json['total_days'] ?? 0,
    currentStreak: json['current_streak'] ?? 0,
    hasMakeupCard: json['has_makeup_card'] == true || json['has_makeup_card'] == 1,
    contribution: json['contribution'] ?? 0,
  );
}
