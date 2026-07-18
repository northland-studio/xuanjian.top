import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/ranking_provider.dart';
import '../widgets/glass_app_bar.dart';
import '../widgets/loading_screen.dart';
import '../config/theme.dart';

class RankingScreen extends StatefulWidget {
  const RankingScreen({super.key});

  @override
  State<RankingScreen> createState() => _RankingScreenState();
}

class _RankingScreenState extends State<RankingScreen> {
  static const _tabs = ['贡献点', '帖子阅读', '帖子点赞', '签到', '股票'];
  static const _types = [
    'contribution',
    'posts_views',
    'posts_likes',
    'checkin',
    'stock'
  ];

  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<RankingProvider>().fetchRankings(_types[_currentIndex]);
    });
  }

  void _onTabChanged(int index) {
    setState(() => _currentIndex = index);
    context.read<RankingProvider>().fetchRankings(_types[index]);
  }

  Color _rankColor(int rank) {
    switch (rank) {
      case 1:
        return const Color(0xFFFFD700); // gold
      case 2:
        return const Color(0xFFC0C0C0); // silver
      case 3:
        return const Color(0xFFCD7F32); // bronze
      default:
        return Colors.transparent;
    }
  }

  Widget _rankWidget(int rank) {
    final color = _rankColor(rank);
    if (color == Colors.transparent) {
      return Text(
        '$rank',
        style: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: AppleTheme.textSecondary,
        ),
      );
    }

    IconData icon;
    if (rank == 1) {
      icon = Icons.emoji_events;
    } else if (rank == 2) {
      icon = Icons.emoji_events;
    } else {
      icon = Icons.emoji_events;
    }

    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color: color.withAlpha(40),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Icon(icon, size: 18, color: color),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rankingProvider = context.watch<RankingProvider>();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: GlassAppBar(
        title: '排行榜',
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(44),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: SegmentedButton<int>(
              segments: List.generate(_tabs.length, (i) {
                return ButtonSegment<int>(
                  value: i,
                  label: Text(
                    _tabs[i],
                    style: TextStyle(
                      fontSize: 13,
                      color: _currentIndex == i
                          ? Colors.white
                          : Colors.white.withAlpha(179),
                    ),
                  ),
                );
              }),
              selected: {_currentIndex},
              onSelectionChanged: (selected) {
                _onTabChanged(selected.first);
              },
              style: ButtonStyle(
                backgroundColor: WidgetStateProperty.resolveWith((states) {
                  if (states.contains(WidgetState.selected)) {
                    return AppleTheme.appleBlue.withAlpha(77);
                  }
                  return Colors.transparent;
                }),
                side: WidgetStateProperty.all(BorderSide.none),
              ),
            ),
          ),
        ),
      ),
      body: rankingProvider.isLoading
          ? const LoadingScreen()
          : rankingProvider.error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error_outline,
                          size: 48, color: AppleTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text(rankingProvider.error!,
                          style: theme.textTheme.bodySmall),
                    ],
                  ),
                )
              : rankingProvider.rankings.isEmpty
                  ? Center(
                      child: Text('暂无排行数据',
                          style: theme.textTheme.bodyLarge?.copyWith(
                              color: AppleTheme.textSecondary)),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: rankingProvider.rankings.length,
                      separatorBuilder: (_, __) =>
                          const Divider(height: 1, indent: 64, endIndent: 16),
                      itemBuilder: (context, index) {
                        final user = rankingProvider.rankings[index];
                        return Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 10),
                          child: Row(
                            children: [
                              SizedBox(
                                width: 40,
                                child: Center(
                                    child: _rankWidget(user.rank)),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Row(
                                  children: [
                                    CircleAvatar(
                                      radius: 16,
                                      backgroundColor:
                                          AppleTheme.lightGray,
                                      child: Text(
                                        user.username.isNotEmpty
                                            ? user.username[0]
                                                .toUpperCase()
                                            : '?',
                                        style: TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                          color: _rankColor(user.rank) ==
                                                  Colors.transparent
                                              ? AppleTheme.appleBlue
                                              : _rankColor(user.rank),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(user.username,
                                              style: theme
                                                  .textTheme.bodyMedium),
                                          if (user.title != null)
                                            Text(
                                              user.title!,
                                              style:
                                                  theme.textTheme.labelSmall?.copyWith(
                                                color: user.titleColor !=
                                                            null &&
                                                        user.titleColor!
                                                            .isNotEmpty
                                                    ? Color(int.parse(
                                                        '0xFF${user.titleColor!.replaceFirst("#", "")}'))
                                                    : AppleTheme
                                                        .textSecondary,
                                              ),
                                            ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Text(
                                '${user.value}',
                                style: theme.textTheme.bodyMedium,
                              ),
                            ],
                          ),
                        );
                      },
                    ),
    );
  }
}
