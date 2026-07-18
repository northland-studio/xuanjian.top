/// API 配置
class ApiConfig {
  static const String baseUrl = 'https://xuanjian.top';
  static const String apiPrefix = '/api';
  
  // 超时配置
  static const Duration connectTimeout = Duration(seconds: 10);
  static const Duration receiveTimeout = Duration(seconds: 15);
  
  // Auth
  static const String login = '$apiPrefix/auth/login';
  static const String register = '$apiPrefix/auth/register';
  static const String me = '$apiPrefix/auth/me';
  static const String profile = '$apiPrefix/auth/profile';
  static const String sendCode = '$apiPrefix/auth/send-code';
  
  // Posts
  static const String posts = '$apiPrefix/posts';
  static const String publicStats = '$apiPrefix/posts/public-stats';
  
  // Upload
  static const String uploadImage = '$apiPrefix/upload/image';
  static const String uploadImages = '$apiPrefix/upload/images';
  
  // Admin
  static const String adminStats = '$apiPrefix/admin/stats';
  static const String adminUsers = '$apiPrefix/admin/users';
  static const String adminPosts = '$apiPrefix/admin/posts';
  static const String adminAnnouncements = '$apiPrefix/admin/announcements';
  static const String adminTheme = '$apiPrefix/admin/theme';
  
  // Announcements
  static const String announcements = '$apiPrefix/announcements';
  
  // Stock
  static const String stocks = '$apiPrefix/stock/stocks';
  static const String portfolio = '$apiPrefix/stock/portfolio';
  static const String stockTransactions = '$apiPrefix/stock/transactions';
  static const String stockTrigger = '$apiPrefix/stock/trigger-update';
  
  // Checkin
  static const String checkinStatus = '$apiPrefix/checkin/status';
  static const String checkin = '$apiPrefix/checkin/checkin';
  static const String checkinMakeup = '$apiPrefix/checkin/makeup';
  static const String checkinBuyCard = '$apiPrefix/checkin/buy-makeup-card';
  static const String checkinRewards = '$apiPrefix/checkin/rewards';
  static const String checkinRanking = '$apiPrefix/checkin/ranking';
  
  // Titles
  static const String titles = '$apiPrefix/titles';
  static const String myTitles = '$apiPrefix/titles/my';
  
  // Shop
  static const String shopItems = '$apiPrefix/shop/items';
  static const String myItems = '$apiPrefix/shop/my-items';
  
  // Claims
  static const String claims = '$apiPrefix/claims';
  
  // Rankings
  static const String rankings = '$apiPrefix/rankings';
  
  // Notifications
  static const String notifications = '$apiPrefix/notifications';
  
  // Password
  static const String forgotPassword = '$apiPrefix/password/forgot-password';
  static const String resetPassword = '$apiPrefix/password/reset-password';
  
  // Social
  static const String douyinUrl = 'https://v.douyin.com/pNyb7PYyn3s/';
  static const String bilibiliUrl = 'https://space.bilibili.com/678742876';
  static const String qqGroupUrl = 'http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=_gw12An9YHGh949KbwjRv03G4FN8KC3p';
  static const String email = 'xuanjian_guild@xuanjian.top';
}
