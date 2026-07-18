import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/post_provider.dart';
import '../providers/auth_provider.dart';
import '../widgets/post_card.dart';
import '../widgets/glass_app_bar.dart';
import '../widgets/loading_screen.dart';
import '../config/theme.dart';
import 'post_detail_screen.dart';
import 'post_editor_screen.dart';

class PostListScreen extends StatefulWidget {
  final String type; // 'daily' | 'decision' | 'forum'

  const PostListScreen({super.key, required this.type});

  @override
  State<PostListScreen> createState() => _PostListScreenState();
}

class _PostListScreenState extends State<PostListScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<PostProvider>().fetchPosts(widget.type);
    });
  }

  String get _title {
    switch (widget.type) {
      case 'daily':
        return '公会日报';
      case 'decision':
        return '决策公示';
      case 'forum':
        return '公会贴吧';
      default:
        return '帖子列表';
    }
  }

  Future<void> _onRefresh() async {
    await context.read<PostProvider>().fetchPosts(widget.type);
  }

  void _navigateToEditor() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => const PostEditorScreen(),
      ),
    ).then((_) {
      _onRefresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final postProvider = context.watch<PostProvider>();

    return Scaffold(
      appBar: GlassAppBar(title: _title),
      body: postProvider.isLoading
          ? const LoadingScreen()
          : postProvider.error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error_outline, size: 48,
                          color: AppleTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text(postProvider.error!,
                          style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 16),
                      TextButton(
                        onPressed: _onRefresh,
                        child: const Text('重试'),
                      ),
                    ],
                  ),
                )
              : postProvider.posts.isEmpty
                  ? Center(
                      child: Text('暂无帖子',
                          style: Theme.of(context)
                              .textTheme
                              .bodyLarge
                              ?.copyWith(color: AppleTheme.textSecondary)),
                    )
                  : RefreshIndicator(
                      onRefresh: _onRefresh,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: postProvider.posts.length,
                        itemBuilder: (context, index) {
                          final post = postProvider.posts[index];
                          return PostCard(
                            post: post,
                            onTap: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) =>
                                      PostDetailScreen(postId: post.id),
                                ),
                              );
                            },
                          );
                        },
                      ),
                    ),
      floatingActionButton: authProvider.isLoggedIn
          ? FloatingActionButton.extended(
              onPressed: _navigateToEditor,
              backgroundColor: AppleTheme.appleBlue,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.edit, size: 20),
              label: const Text('发布'),
            )
          : null,
    );
  }
}
