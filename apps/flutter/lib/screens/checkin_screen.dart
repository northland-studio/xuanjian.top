import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/checkin_provider.dart';
import '../widgets/glass_app_bar.dart';
import '../widgets/loading_screen.dart';
import '../widgets/apple_button.dart';
import '../config/theme.dart';

class CheckinScreen extends StatefulWidget {
  const CheckinScreen({super.key});

  @override
  State<CheckinScreen> createState() => _CheckinScreenState();
}

class _CheckinScreenState extends State<CheckinScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;
  late final Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.08).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CheckinProvider>().fetchStatus();
    });
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  void _startPulse() {
    _pulseController.repeat(reverse: true);
  }

  void _stopPulse() {
    _pulseController.stop();
    _pulseController.reset();
  }

  Future<void> _doCheckin() async {
    final provider = context.read<CheckinProvider>();
    final success = await provider.doCheckin();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(success ? '签到成功！' : (provider.error ?? '签到失败'))),
      );
      if (success) {
        _stopPulse();
      }
    }
  }

  Future<void> _doMakeup() async {
    final provider = context.read<CheckinProvider>();
    final success = await provider.doMakeup();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(success ? '补签成功！' : (provider.error ?? '补签失败'))),
      );
    }
  }

  Future<void> _buyCard() async {
    final provider = context.read<CheckinProvider>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('购买补签卡'),
        content: const Text('确认花费贡献点购买一张补签卡吗？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          AppleButton.primary(
            label: '确认购买',
            onPressed: () => Navigator.pop(ctx, true),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      final success = await provider.buyMakeupCard();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content:
                  Text(success ? '购买成功！' : (provider.error ?? '购买失败'))),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final checkinProvider = context.watch<CheckinProvider>();
    final status = checkinProvider.status;
    final theme = Theme.of(context);

    if (checkinProvider.isLoading && status == null) {
      return Scaffold(
        appBar: const GlassAppBar(title: '签到'),
        body: const LoadingScreen(),
      );
    }

    // Start pulsing if can check in
    if (status?.canCheckin == true && !_pulseController.isAnimating) {
      _startPulse();
    }

    return Scaffold(
      appBar: const GlassAppBar(title: '签到'),
      body: RefreshIndicator(
        onRefresh: () => checkinProvider.fetchStatus(),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              // Header: Streak info
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: theme.cardColor,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        _StatBox(
                            label: '连续签到',
                            value: '${status?.currentStreak ?? 0} 天'),
                        Container(
                          width: 1,
                          height: 36,
                          color: AppleTheme.dividerColor,
                          margin:
                              const EdgeInsets.symmetric(horizontal: 24),
                        ),
                        _StatBox(
                            label: '累计签到',
                            value: '${status?.totalDays ?? 0} 天'),
                      ],
                    ),
                    if (status != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        '贡献点: ${status.contribution}',
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 24),
              // 签到 Button
              AnimatedBuilder(
                animation: _pulseAnimation,
                builder: (context, child) {
                  return Transform.scale(
                    scale: _pulseAnimation.value,
                    child: child,
                  );
                },
                child: SizedBox(
                  width: 160,
                  height: 160,
                  child: ElevatedButton(
                    onPressed: (status?.canCheckin == true)
                        ? _doCheckin
                        : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: (status?.canCheckin == true)
                          ? AppleTheme.appleBlue
                          : AppleTheme.textTertiary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(80)),
                      elevation: 0,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.edit_calendar,
                          size: 40,
                          color: (status?.canCheckin == true)
                              ? Colors.white
                              : Colors.white.withAlpha(179),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '签到',
                          style: theme.textTheme.titleLarge?.copyWith(
                            color: (status?.canCheckin == true)
                                ? Colors.white
                                : Colors.white.withAlpha(179),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              // 补签 & 购买按钮
              if (status != null) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (status.hasMakeupCard)
                      Padding(
                        padding: const EdgeInsets.only(right: 12),
                        child: AppleButton.pill(
                          label: '补签',
                          onPressed: _doMakeup,
                        ),
                      ),
                    AppleButton.pill(
                      label: '购买补签卡',
                      onPressed: _buyCard,
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 32),
              // Reward tiers
              Align(
                alignment: Alignment.centerLeft,
                child: Text('签到奖励',
                    style: theme.textTheme.titleLarge),
              ),
              const SizedBox(height: 12),
              _buildRewardTier(theme, 1, '贡献点 +10', Icons.star_border),
              _buildRewardTier(theme, 3, '贡献点 +30', Icons.star_half),
              _buildRewardTier(theme, 7, '贡献点 +100 + 补签卡', Icons.star),
              _buildRewardTier(theme, 30, '贡献点 +500 + 限定称号',
                  Icons.workspace_premium),
              _buildRewardTier(theme, 100, '贡献点 +2000 + 稀有称号',
                  Icons.diamond),
              _buildRewardTier(theme, 365, '贡献点 +10000 + 传奇称号',
                  Icons.emoji_events),
              const SizedBox(height: 32),
              // Leaderboard
              Align(
                alignment: Alignment.centerLeft,
                child: Text('签到排行榜',
                    style: theme.textTheme.titleLarge),
              ),
              const SizedBox(height: 12),
              Container(
                decoration: BoxDecoration(
                  color: theme.cardColor,
                  borderRadius: BorderRadius.circular(16),
                ),
                padding: const EdgeInsets.all(16),
                child: const Center(
                  child: Text('排行榜数据加载中...'),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRewardTier(
      ThemeData theme, int days, String reward, IconData icon) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: theme.cardColor,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(icon, size: 24, color: AppleTheme.appleBlue),
            const SizedBox(width: 12),
            Expanded(
              child: Text('连续 $days 天签到', style: theme.textTheme.bodyMedium),
            ),
            Text(reward, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _StatBox extends StatelessWidget {
  final String label;
  final String value;

  const _StatBox({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Text(value, style: theme.textTheme.headlineLarge),
        const SizedBox(height: 4),
        Text(label, style: theme.textTheme.bodySmall),
      ],
    );
  }
}
