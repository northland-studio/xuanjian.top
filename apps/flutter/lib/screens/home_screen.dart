import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/auth_provider.dart';
import '../providers/post_provider.dart';
import '../providers/notification_provider.dart';
import '../models/post.dart';
import '../models/notification.dart';
import '../config/theme.dart';
import '../config/api_config.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;

  final List<Widget> _tabs = const [
    _HomeTab(),
    _ForumTab(),
    _DailyTab(),
    _NotificationsTab(),
    _ProfileTab(),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadInitialData();
    });
  }

  void _loadInitialData() {
    final postProvider = context.read<PostProvider>();
    // 预加载默认标签数据
    if (_currentIndex == 1) {
      postProvider.fetchPosts('forum');
    } else if (_currentIndex == 2) {
      postProvider.fetchPosts('daily');
    }
  }

  void _onTabTapped(int index) {
    if (index == _currentIndex) return;
    setState(() {
      _currentIndex = index;
    });
    if (index == 1) {
      context.read<PostProvider>().fetchPosts('forum');
    } else if (index == 2) {
      context.read<PostProvider>().fetchPosts('daily');
    } else if (index == 3) {
      context.read<NotificationProvider>().fetchNotifications();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: _buildGlassAppBar(),
      body: _tabs[_currentIndex],
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  PreferredSizeWidget _buildGlassAppBar() {
    return PreferredSize(
      preferredSize: const Size.fromHeight(kToolbarHeight + 44),
      child: Container(
        decoration: BoxDecoration(
          color: AppleTheme.navGlass,
        ),
        child: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          title: Text(
            '玄剑公会',
            style: GoogleFonts.inter(
              fontSize: 17,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
          ),
          leading: GestureDetector(
            onTap: () => _onTabTapped(4),
            child: Padding(
              padding: const EdgeInsets.all(8.0),
              child: Consumer<AuthProvider>(
                builder: (context, auth, _) {
                  final user = auth.user;
                  return CircleAvatar(
                    backgroundColor: AppleTheme.appleBlue.withAlpha(40),
                    child: user != null
                        ? Text(
                            user.username.substring(0, 1).toUpperCase(),
                            style: GoogleFonts.inter(
                              color: AppleTheme.appleBlue,
                              fontWeight: FontWeight.w600,
                            ),
                          )
                        : const Icon(Icons.person, color: AppleTheme.appleBlue, size: 20),
                  );
                },
              ),
            ),
          ),
          centerTitle: true,
        ),
      ),
    );
  }

  Widget _buildBottomNav() {
    return NavigationBar(
      selectedIndex: _currentIndex,
      onDestinationSelected: _onTabTapped,
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.flag_outlined),
          selectedIcon: Icon(Icons.flag),
          label: '首页',
        ),
        NavigationDestination(
          icon: Icon(Icons.forum_outlined),
          selectedIcon: Icon(Icons.forum),
          label: '论坛',
        ),
        NavigationDestination(
          icon: Icon(Icons.article_outlined),
          selectedIcon: Icon(Icons.article),
          label: '日报',
        ),
        NavigationDestination(
          icon: Icon(Icons.notifications_outlined),
          selectedIcon: Icon(Icons.notifications),
          label: '通知',
        ),
        NavigationDestination(
          icon: Icon(Icons.person_outline),
          selectedIcon: Icon(Icons.person),
          label: '我的',
        ),
      ],
    );
  }
}

// ─── Home Tab ───

class _HomeTab extends StatelessWidget {
  const _HomeTab();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, kToolbarHeight + 52, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '功能',
              style: GoogleFonts.inter(
                fontSize: 21,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).textTheme.bodyLarge?.color,
              ),
            ),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: 2,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              childAspectRatio: 1.25,
              children: [
                _FeatureCard(
                  icon: Icons.edit_note,
                  title: '日报',
                  description: '每日工作报告',
                  color: Colors.orange,
                  onTap: () {},
                ),
                _FeatureCard(
                  icon: Icons.lightbulb,
                  title: '决策',
                  description: '公会重要决策',
                  color: Colors.amber,
                  onTap: () {},
                ),
                _FeatureCard(
                  icon: Icons.chat_bubble,
                  title: '贴吧',
                  description: '公会讨论广场',
                  color: Colors.blue,
                  onTap: () {
                    final homeScreen = context.findAncestorStateOfType<_HomeScreenState>();
                    homeScreen?._onTabTapped(1);
                  },
                ),
                _FeatureCard(
                  icon: Icons.trending_up,
                  title: '股市',
                  description: '虚拟股票交易',
                  color: Colors.green,
                  onTap: () {},
                ),
                _FeatureCard(
                  icon: Icons.how_to_reg,
                  title: '签到',
                  description: '每日签到领奖',
                  color: Colors.purple,
                  onTap: () {},
                ),
                _FeatureCard(
                  icon: Icons.store,
                  title: '商城',
                  description: '公会积分商城',
                  color: Colors.red,
                  onTap: () {},
                ),
                _FeatureCard(
                  icon: Icons.leaderboard,
                  title: '排行榜',
                  description: '公会贡献排行',
                  color: Colors.teal,
                  onTap: () {},
                ),
                _FeatureCard(
                  icon: Icons.share,
                  title: '社交媒体',
                  description: '关注我们',
                  color: Colors.pink,
                  onTap: () {},
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final Color color;
  final VoidCallback onTap;

  const _FeatureCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withAlpha(30),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(height: 10),
              Text(
                title,
                style: GoogleFonts.inter(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).textTheme.bodyLarge?.color,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                description,
                style: GoogleFonts.inter(
                  fontSize: 12,
                  color: AppleTheme.textSecondary,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Forum Tab ───

class _ForumTab extends StatelessWidget {
  const _ForumTab();

  @override
  Widget build(BuildContext context) {
    return Consumer<PostProvider>(
      builder: (context, postProvider, _) {
        if (postProvider.posts.isEmpty && !postProvider.isLoading) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            postProvider.fetchPosts('forum');
          });
        }
        return _PostListView(postProvider: postProvider);
      },
    );
  }
}

// ─── Daily Tab ───

class _DailyTab extends StatelessWidget {
  const _DailyTab();

  @override
  Widget build(BuildContext context) {
    return Consumer<PostProvider>(
      builder: (context, postProvider, _) {
        if (postProvider.posts.isEmpty && !postProvider.isLoading) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            postProvider.fetchPosts('daily');
          });
        }
        return _PostListView(postProvider: postProvider);
      },
    );
  }
}

class _PostListView extends StatelessWidget {
  final PostProvider postProvider;

  const _PostListView({required this.postProvider});

  @override
  Widget build(BuildContext context) {
    if (postProvider.isLoading) {
      return const SafeArea(
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (postProvider.error != null) {
      return SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: AppleTheme.textSecondary),
              const SizedBox(height: 16),
              Text(postProvider.error!, style: GoogleFonts.inter(color: AppleTheme.textSecondary)),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: () => postProvider.fetchPosts('forum'), child: const Text('重试')),
            ],
          ),
        ),
      );
    }

    if (postProvider.posts.isEmpty) {
      return SafeArea(
        child: Center(
          child: Text(
            '暂无帖子',
            style: GoogleFonts.inter(
              fontSize: 17,
              color: AppleTheme.textSecondary,
            ),
          ),
        ),
      );
    }

    return SafeArea(
      child: RefreshIndicator(
        onRefresh: () => postProvider.fetchPosts(postProvider.posts.isNotEmpty ? postProvider.posts.first.type : 'forum'),
        child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, kToolbarHeight + 48, 16, 80),
          itemCount: postProvider.posts.length,
          itemBuilder: (context, index) {
            final post = postProvider.posts[index];
            return _PostCardWidget(post: post);
          },
        ),
      ),
    );
  }
}

class _PostCardWidget extends StatelessWidget {
  final Post post;

  const _PostCardWidget({required this.post});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          // Navigate to post detail
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 18,
                    backgroundColor: AppleTheme.appleBlue.withAlpha(30),
                    child: Text(
                      post.authorName.isNotEmpty ? post.authorName.substring(0, 1).toUpperCase() : '?',
                      style: GoogleFonts.inter(color: AppleTheme.appleBlue, fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          post.authorName,
                          style: GoogleFonts.inter(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: Theme.of(context).textTheme.bodyLarge?.color,
                          ),
                        ),
                        Text(
                          _formatTime(post.createdAt),
                          style: GoogleFonts.inter(
                            fontSize: 12,
                            color: AppleTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                post.title,
                style: GoogleFonts.inter(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  color: Theme.of(context).textTheme.bodyLarge?.color,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 8),
              Text(
                post.content,
                style: GoogleFonts.inter(
                  fontSize: 14,
                  color: AppleTheme.textSecondary,
                  height: 1.4,
                ),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _StatChip(icon: Icons.visibility_outlined, count: post.views),
                  const SizedBox(width: 16),
                  _StatChip(icon: post.isLiked ? Icons.favorite : Icons.favorite_border, count: post.likes),
                  const SizedBox(width: 16),
                  _StatChip(icon: Icons.chat_bubble_outline, count: post.comments),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _StatChip({required IconData icon, required int count}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppleTheme.textSecondary),
        const SizedBox(width: 4),
        Text(
          count.toString(),
          style: GoogleFonts.inter(fontSize: 12, color: AppleTheme.textSecondary),
        ),
      ],
    );
  }

  String _formatTime(String timeStr) {
    if (timeStr.isEmpty) return '';
    try {
      final dt = DateTime.parse(timeStr);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 60) return '${diff.inMinutes}分钟前';
      if (diff.inHours < 24) return '${diff.inHours}小时前';
      if (diff.inDays < 7) return '${diff.inDays}天前';
      return '${dt.month}/${dt.day}';
    } catch (_) {
      return timeStr;
    }
  }
}

// ─── Notifications Tab ───

class _NotificationsTab extends StatelessWidget {
  const _NotificationsTab();

  @override
  Widget build(BuildContext context) {
    return Consumer<NotificationProvider>(
      builder: (context, notificationProvider, _) {
        if (notificationProvider.isLoading) {
          return const SafeArea(
            child: Center(child: CircularProgressIndicator()),
          );
        }

        if (notificationProvider.error != null) {
          return SafeArea(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline, size: 48, color: AppleTheme.textSecondary),
                  const SizedBox(height: 16),
                  Text(notificationProvider.error!, style: GoogleFonts.inter(color: AppleTheme.textSecondary)),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => notificationProvider.fetchNotifications(),
                    child: const Text('重试'),
                  ),
                ],
              ),
            ),
          );
        }

        if (notificationProvider.notifications.isEmpty) {
          return SafeArea(
            child: Center(
              child: Text(
                '暂无通知',
                style: GoogleFonts.inter(fontSize: 17, color: AppleTheme.textSecondary),
              ),
            ),
          );
        }

        return SafeArea(
          child: Column(
            children: [
              if (notificationProvider.unreadCount > 0)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${notificationProvider.unreadCount} 条未读',
                        style: GoogleFonts.inter(fontSize: 13, color: AppleTheme.textSecondary),
                      ),
                      GestureDetector(
                        onTap: () => notificationProvider.markAllRead(),
                        child: Text(
                          '全部已读',
                          style: GoogleFonts.inter(fontSize: 13, color: AppleTheme.appleBlue, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => notificationProvider.fetchNotifications(),
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 80),
                    itemCount: notificationProvider.notifications.length,
                    itemBuilder: (context, index) {
                      final notification = notificationProvider.notifications[index];
                      return _NotificationCard(
                        notification: notification,
                        onTap: () => notificationProvider.markRead(notification.id),
                      );
                    },
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _NotificationCard extends StatelessWidget {
  final AppNotification notification;
  final VoidCallback onTap;

  const _NotificationCard({required this.notification, required this.onTap});

  IconData _getIcon() {
    switch (notification.type) {
      case 'comment':
        return Icons.chat_bubble;
      case 'like':
        return Icons.favorite;
      case 'announcement':
        return Icons.campaign;
      default:
        return Icons.notifications;
    }
  }

  Color _getIconColor() {
    switch (notification.type) {
      case 'comment':
        return Colors.blue;
      case 'like':
        return Colors.red;
      case 'announcement':
        return Colors.orange;
      default:
        return AppleTheme.appleBlue;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: notification.isRead ? Theme.of(context).cardColor : AppleTheme.appleBlue.withAlpha(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: _getIconColor().withAlpha(30),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(_getIcon(), color: _getIconColor(), size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            notification.title,
                            style: GoogleFonts.inter(
                              fontSize: 15,
                              fontWeight: notification.isRead ? FontWeight.w400 : FontWeight.w600,
                              color: Theme.of(context).textTheme.bodyLarge?.color,
                            ),
                          ),
                        ),
                        if (!notification.isRead)
                          Container(
                            width: 8,
                            height: 8,
                            decoration: const BoxDecoration(
                              color: AppleTheme.appleBlue,
                              shape: BoxShape.circle,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      notification.content,
                      style: GoogleFonts.inter(fontSize: 13, color: AppleTheme.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _formatTime(notification.createdAt),
                      style: GoogleFonts.inter(fontSize: 11, color: AppleTheme.textTertiary),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatTime(String timeStr) {
    if (timeStr.isEmpty) return '';
    try {
      final dt = DateTime.parse(timeStr);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 60) return '${diff.inMinutes}分钟前';
      if (diff.inHours < 24) return '${diff.inHours}小时前';
      if (diff.inDays < 7) return '${diff.inDays}天前';
      return '${dt.month}/${dt.day}';
    } catch (_) {
      return timeStr;
    }
  }
}

// ─── Profile Tab ───

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        final user = auth.user;

        return SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, kToolbarHeight + 48, 16, 80),
            child: user != null ? _buildLoggedInProfile(context, auth, user) : _buildLoginPrompt(context),
          ),
        );
      },
    );
  }

  Widget _buildLoggedInProfile(BuildContext context, AuthProvider auth, User user) {
    return Column(
      children: [
        const SizedBox(height: 20),
        CircleAvatar(
          radius: 48,
          backgroundColor: AppleTheme.appleBlue.withAlpha(30),
          child: Text(
            user.username.substring(0, 1).toUpperCase(),
            style: GoogleFonts.inter(
              fontSize: 36,
              fontWeight: FontWeight.w700,
              color: AppleTheme.appleBlue,
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          user.username,
          style: GoogleFonts.inter(
            fontSize: 21,
            fontWeight: FontWeight.w700,
            color: Theme.of(context).textTheme.bodyLarge?.color,
          ),
        ),
        const SizedBox(height: 4),
        if (user.titleName != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: _parseTitleColor(user.titleColor).withAlpha(30),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              user.titleName!,
              style: GoogleFonts.inter(fontSize: 12, color: _parseTitleColor(user.titleColor)),
            ),
          ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _ProfileStat(label: '等级', value: 'Lv.${user.level}'),
            Container(width: 1, height: 24, color: AppleTheme.dividerColor),
            _ProfileStat(label: '贡献', value: user.contribution.toString()),
          ],
        ),
        const SizedBox(height: 28),
        _ProfileMenuItem(
          icon: Icons.settings,
          title: '设置',
          onTap: () {},
        ),
        _ProfileMenuItem(
          icon: Icons.history,
          title: '我的帖子',
          onTap: () {},
        ),
        _ProfileMenuItem(
          icon: Icons.card_giftcard,
          title: '我的物品',
          onTap: () {},
        ),
        _ProfileMenuItem(
          icon: Icons.help_outline,
          title: '帮助与反馈',
          onTap: () {},
        ),
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: () {
              auth.logout();
            },
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.red,
              side: const BorderSide(color: Colors.red),
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: Text('退出登录', style: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w600)),
          ),
        ),
      ],
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

  Widget _buildLoginPrompt(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.only(top: 80),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                color: AppleTheme.appleBlue.withAlpha(20),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.shield, size: 56, color: AppleTheme.appleBlue),
            ),
            const SizedBox(height: 24),
            Text(
              '玄剑公会',
              style: GoogleFonts.inter(
                fontSize: 28,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).textTheme.bodyLarge?.color,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '登录以获取完整功能体验',
              style: GoogleFonts.inter(fontSize: 15, color: AppleTheme.textSecondary),
            ),
            const SizedBox(height: 32),
            SizedBox(
              width: 200,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pushNamed(context, '/login');
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppleTheme.appleBlue,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: Text('登录 / 注册', style: GoogleFonts.inter(fontSize: 15, fontWeight: FontWeight.w600)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfileStat extends StatelessWidget {
  final String label;
  final String value;

  const _ProfileStat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        children: [
          Text(
            value,
            style: GoogleFonts.inter(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: Theme.of(context).textTheme.bodyLarge?.color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: GoogleFonts.inter(fontSize: 12, color: AppleTheme.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _ProfileMenuItem extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback onTap;

  const _ProfileMenuItem({required this.icon, required this.title, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: ListTile(
        leading: Icon(icon, color: AppleTheme.appleBlue, size: 22),
        title: Text(
          title,
          style: GoogleFonts.inter(
            fontSize: 15,
            color: Theme.of(context).textTheme.bodyLarge?.color,
          ),
        ),
        trailing: const Icon(Icons.chevron_right, color: AppleTheme.textTertiary, size: 20),
        onTap: onTap,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      ),
    );
  }
}
