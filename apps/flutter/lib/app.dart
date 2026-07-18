import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/theme_provider.dart';
import 'providers/auth_provider.dart';
import 'config/theme.dart';
import 'screens/splash_screen.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/register_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/post_list_screen.dart';
import 'screens/post_detail_screen.dart';
import 'screens/post_editor_screen.dart';
import 'screens/stock_screen.dart';
import 'screens/checkin_screen.dart';
import 'screens/shop_screen.dart';
import 'screens/ranking_screen.dart';

class XuanjianApp extends StatelessWidget {
  const XuanjianApp({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<ThemeProvider>(
      builder: (context, themeProvider, _) {
        return MaterialApp(
          title: '玄剑公会',
          debugShowCheckedModeBanner: false,
          theme: AppleTheme.lightTheme,
          darkTheme: AppleTheme.darkTheme,
          themeMode: themeProvider.themeMode,
          initialRoute: '/splash',
          onGenerateRoute: (settings) {
            final args = settings.arguments;

            switch (settings.name) {
              // Core
              case '/splash':
                return _buildRoute(const SplashScreen(), settings);
              case '/home':
                return _buildRoute(const HomeScreen(), settings);

              // Auth
              case '/login':
                return _buildRoute(const LoginScreen(), settings);
              case '/register':
                return _buildRoute(const RegisterScreen(), settings);

              // User
              case '/profile':
                return _buildRoute(const ProfileScreen(), settings);
              case '/settings':
                return _buildRoute(const SettingsScreen(), settings);

              // Posts
              case '/posts':
                final type = args is String ? args : '';
                return _buildRoute(PostListScreen(type: type), settings);
              case '/post-detail':
                final postId = args is int ? args : 0;
                return _buildRoute(PostDetailScreen(postId: postId), settings);
              case '/post-editor':
                return _buildRoute(const PostEditorScreen(), settings);

              // Features
              case '/stock':
                return _buildRoute(const StockScreen(), settings);
              case '/checkin':
                return _buildRoute(const CheckinScreen(), settings);
              case '/shop':
                return _buildRoute(const ShopScreen(), settings);
              case '/rankings':
                return _buildRoute(const RankingScreen(), settings);

              default:
                return _buildRoute(const HomeScreen(), settings);
            }
          },
        );
      },
    );
  }

  PageRouteBuilder _buildRoute(Widget page, RouteSettings settings) {
    return PageRouteBuilder(
      settings: settings,
      pageBuilder: (context, animation, secondaryAnimation) => page,
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        return FadeTransition(opacity: animation, child: child);
      },
      transitionDuration: const Duration(milliseconds: 300),
    );
  }
}
