import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/auth_provider.dart';
import '../providers/theme_provider.dart';
import '../models/user.dart';
import '../config/theme.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, authProvider, _) {
        final user = authProvider.user;

        return Scaffold(
          backgroundColor: Theme.of(context).scaffoldBackgroundColor,
          appBar: AppBar(
            title: const Text('个人中心'),
            centerTitle: true,
          ),
          body: user == null
              ? const Center(child: CircularProgressIndicator())
              : SingleChildScrollView(
                  child: Column(
                    children: [
                      const SizedBox(height: 32),
                      _buildUserInfoSection(context, user),
                      const SizedBox(height: 24),
                      _buildStatsRow(context),
                      const SizedBox(height: 24),
                      _buildSettingsList(context, authProvider, user),
                    ],
                  ),
                ),
        );
      },
    );
  }

  Widget _buildUserInfoSection(BuildContext context, User user) {
    final titleColor = _parseTitleColor(user.titleColor);
    final firstLetter = user.username.isNotEmpty
        ? user.username[0].toUpperCase()
        : '?';

    return Column(
      children: [
        // Avatar
        CircleAvatar(
          radius: 40,
          backgroundColor: AppleTheme.appleBlue,
          child: Text(
            firstLetter,
            style: GoogleFonts.inter(
              fontSize: 32,
              fontWeight: FontWeight.w700,
              color: AppleTheme.white,
            ),
          ),
        ),
        const SizedBox(height: 16),
        // Username
        Text(
          user.username,
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 8),
        // Level Badge + Title
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _buildLevelBadge(user.level),
            if (user.titleName != null && user.titleName!.isNotEmpty) ...[
              const SizedBox(width: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: titleColor.withAlpha(30),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: titleColor, width: 1),
                ),
                child: Text(
                  user.titleName!,
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: titleColor,
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 8),
        // Contribution
        Text(
          '贡献值: ${user.contribution}',
          style: GoogleFonts.inter(
            fontSize: 14,
            color: AppleTheme.textSecondary,
          ),
        ),
      ],
    );
  }

  Widget _buildLevelBadge(int level) {
    final levelColors = {
      1: const Color(0xFFCD7F32), // 青铜
      2: const Color(0xFFC0C0C0), // 白银
      3: const Color(0xFFFFD700), // 黄金
      4: const Color(0xFF00BFFF), // 钻石
    };
    final levelNames = {
      1: 'Lv.1',
      2: 'Lv.2',
      3: 'Lv.3',
      4: 'Lv.4',
    };
    final color = levelColors[level] ?? AppleTheme.textSecondary;
    final name = levelNames[level] ?? 'Lv.$level';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withAlpha(30),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color, width: 1),
      ),
      child: Text(
        name,
        style: GoogleFonts.inter(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }

  Widget _buildStatsRow(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _buildStatItem('帖子', 0),
          _buildStatItem('评论', 0),
          _buildStatItem('获赞', 0),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, int count) {
    return Column(
      children: [
        Text(
          count.toString(),
          style: GoogleFonts.inter(
            fontSize: 24,
            fontWeight: FontWeight.w700,
            color: AppleTheme.appleBlue,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 14,
            color: AppleTheme.textSecondary,
          ),
        ),
      ],
    );
  }

  Widget _buildSettingsList(
      BuildContext context, AuthProvider authProvider, User user) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          // 修改资料
          _buildListTile(
            context,
            icon: Icons.edit_outlined,
            title: '修改资料',
            onTap: () {
              Navigator.pushNamed(context, '/settings');
            },
          ),
          _buildDivider(context),
          // 修改密码
          _buildListTile(
            context,
            icon: Icons.lock_outline,
            title: '修改密码',
            onTap: () {
              Navigator.pushNamed(context, '/settings', arguments: {'tab': 1});
            },
          ),
          _buildDivider(context),
          // 深色模式
          Consumer<ThemeProvider>(
            builder: (context, themeProvider, _) {
              return _buildListTile(
                context,
                icon: Icons.dark_mode_outlined,
                title: '深色模式',
                trailing: Switch(
                  value: themeProvider.themeMode == ThemeMode.dark,
                  onChanged: (value) {
                    themeProvider.setThemeMode(
                      value ? ThemeMode.dark : ThemeMode.light,
                    );
                  },
                  activeColor: AppleTheme.appleBlue,
                ),
                onTap: null,
              );
            },
          ),
          _buildDivider(context),
          // 退出登录
          _buildListTile(
            context,
            icon: Icons.logout,
            title: '退出登录',
            titleColor: Colors.red,
            onTap: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('确认退出'),
                  content: const Text('确定要退出登录吗？'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('取消'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: const Text(
                        '退出',
                        style: TextStyle(color: Colors.red),
                      ),
                    ),
                  ],
                ),
              );
              if (confirmed == true && context.mounted) {
                await authProvider.logout();
                if (context.mounted) {
                  Navigator.pushReplacementNamed(context, '/login');
                }
              }
            },
          ),
          // 管理系统
          if (user.level >= 1 && user.level != 3) ...[
            _buildDivider(context),
            _buildListTile(
              context,
              icon: Icons.admin_panel_settings_outlined,
              title: '管理系统',
              titleColor: AppleTheme.appleBlue,
              onTap: () {
                Navigator.pushNamed(context, '/admin');
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildListTile(
    BuildContext context, {
    required IconData icon,
    required String title,
    Color? titleColor,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: titleColor ?? AppleTheme.appleBlue, size: 22),
      title: Text(
        title,
        style: GoogleFonts.inter(
          fontSize: 17,
          fontWeight: FontWeight.w400,
          color: titleColor,
        ),
      ),
      trailing: trailing ??
          (onTap != null
              ? const Icon(Icons.chevron_right, color: AppleTheme.textTertiary)
              : null),
      onTap: onTap,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  Widget _buildDivider(BuildContext context) {
    return Divider(
      height: 1,
      indent: 56,
      color: Theme.of(context).dividerColor,
    );
  }

  Color _parseTitleColor(String? hexColor) {
    if (hexColor == null || hexColor.isEmpty) return AppleTheme.appleBlue;
    try {
      final hex = hexColor.replaceFirst('#', '');
      return Color(int.parse('FF$hex', radix: 16));
    } catch (_) {
      return AppleTheme.appleBlue;
    }
  }
}
