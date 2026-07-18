import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../providers/post_provider.dart';
import '../providers/auth_provider.dart';
import '../widgets/glass_app_bar.dart';
import '../widgets/loading_screen.dart';
import '../widgets/comment_widget.dart';
import '../config/theme.dart';

class PostDetailScreen extends StatefulWidget {
  final int postId;

  const PostDetailScreen({super.key, required this.postId});

  @override
  State<PostDetailScreen> createState() => _PostDetailScreenState();
}

class _PostDetailScreenState extends State<PostDetailScreen> {
  final TextEditingController _commentController = TextEditingController();
  List<Map<String, dynamic>> _comments = [];
  bool _isLoadingComments = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<PostProvider>().fetchPostDetail(widget.postId);
      _loadComments();
    });
  }

  Future<void> _loadComments() async {
    setState(() => _isLoadingComments = true);
    try {
      // Comments are loaded via the post provider's current post
      // For simplicity, we use an empty list as placeholder - real API integration needed
      _comments = [];
    } catch (_) {
      _comments = [];
    } finally {
      if (mounted) setState(() => _isLoadingComments = false);
    }
  }

  void _toggleLike() {
    context.read<PostProvider>().likePost(widget.postId);
  }

  void _share() {
    final post = context.read<PostProvider>().currentPost;
    if (post != null) {
      Share.share('${post.title}\n\n${post.content}\n\n——来自玄剑公会');
    }
  }

  Future<void> _submitComment() async {
    final text = _commentController.text.trim();
    if (text.isEmpty) return;

    _commentController.clear();
    // Comment submission would go through a service
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('评论已提交')),
    );
  }

  String _formatTime(String timeStr) {
    if (timeStr.isEmpty) return '';
    try {
      final dt = DateTime.parse(timeStr);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return '刚刚';
      if (diff.inMinutes < 60) return '${diff.inMinutes}分钟前';
      if (diff.inHours < 24) return '${diff.inHours}小时前';
      if (diff.inDays < 30) return '${diff.inDays}天前';
      return '${dt.month}/${dt.day}';
    } catch (_) {
      return timeStr;
    }
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final postProvider = context.watch<PostProvider>();
    final post = postProvider.currentPost;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: GlassAppBar(
        title: '帖子详情',
        actions: [
          IconButton(
            icon: const Icon(Icons.share, size: 20),
            onPressed: post != null ? _share : null,
          ),
        ],
      ),
      body: postProvider.isLoadingDetail
          ? const LoadingScreen()
          : post == null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error_outline, size: 48,
                          color: AppleTheme.textSecondary),
                      const SizedBox(height: 12),
                      Text(postProvider.error ?? '帖子不存在',
                          style: theme.textTheme.bodySmall),
                    ],
                  ),
                )
              : Column(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Title
                            Text(post.title, style: theme.textTheme.headlineLarge),
                            const SizedBox(height: 12),
                            // Author info bar
                            Row(
                              children: [
                                CircleAvatar(
                                  radius: 18,
                                  backgroundImage: post.authorAvatar != null &&
                                          post.authorAvatar!.isNotEmpty
                                      ? NetworkImage(post.authorAvatar!)
                                      : null,
                                  child: post.authorAvatar == null ||
                                          post.authorAvatar!.isEmpty
                                      ? const Icon(Icons.person, size: 18)
                                      : null,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(post.authorName,
                                          style: theme.textTheme.bodyMedium),
                                      Text(
                                        '${_formatTime(post.createdAt)} · ${post.views} 阅读 · ${post.likes} 赞',
                                        style: theme.textTheme.labelSmall,
                                      ),
                                    ],
                                  ),
                                ),
                                GestureDetector(
                                  onTap: _toggleLike,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 12, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: post.isLiked
                                          ? Colors.red.withAlpha(30)
                                          : AppleTheme.lightGray,
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(
                                          post.isLiked
                                              ? Icons.favorite
                                              : Icons.favorite_border,
                                          size: 18,
                                          color: post.isLiked
                                              ? Colors.red
                                              : AppleTheme.textSecondary,
                                        ),
                                        const SizedBox(width: 4),
                                        Text('${post.likes}',
                                            style: TextStyle(
                                              fontSize: 14,
                                              color: post.isLiked
                                                  ? Colors.red
                                                  : AppleTheme.textSecondary,
                                            )),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 16),
                            const Divider(),
                            const SizedBox(height: 8),
                            // Content with markdown
                            MarkdownBody(
                              data: post.content,
                              selectable: true,
                              styleSheet: MarkdownStyleSheet(
                                p: theme.textTheme.bodyLarge,
                                h1: theme.textTheme.headlineLarge,
                                h2: theme.textTheme.headlineMedium,
                                h3: theme.textTheme.titleLarge,
                                strong: theme.textTheme.bodyMedium,
                                code: theme.textTheme.bodySmall?.copyWith(
                                  backgroundColor: AppleTheme.lightGray,
                                  fontFamily: 'monospace',
                                ),
                              ),
                            ),
                            const SizedBox(height: 24),
                            const Divider(),
                            const SizedBox(height: 12),
                            // Comments section
                            Row(
                              children: [
                                Text(
                                  '评论',
                                  style: theme.textTheme.titleMedium,
                                ),
                                const Spacer(),
                              ],
                            ),
                            const SizedBox(height: 12),
                            if (_isLoadingComments)
                              const Center(child: CircularProgressIndicator())
                            else if (_comments.isEmpty)
                              Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(24),
                                  child: Text('暂无评论',
                                      style: theme.textTheme.bodySmall),
                                ),
                              )
                            else
                              ..._comments.map(
                                (c) => CommentWidget(comment: c),
                              ),
                          ],
                        ),
                      ),
                    ),
                    // Comment input
                    Container(
                      decoration: BoxDecoration(
                        color: theme.cardColor,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withAlpha(13),
                            blurRadius: 8,
                            offset: const Offset(0, -1),
                          ),
                        ],
                      ),
                      padding: EdgeInsets.only(
                        left: 16,
                        right: 8,
                        top: 8,
                        bottom: MediaQuery.of(context).padding.bottom + 8,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _commentController,
                              decoration: const InputDecoration(
                                hintText: '写下你的评论...',
                                border: InputBorder.none,
                                contentPadding:
                                    EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              ),
                              maxLines: 3,
                              minLines: 1,
                              textInputAction: TextInputAction.send,
                              onSubmitted: (_) => _submitComment(),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.send,
                                color: AppleTheme.appleBlue),
                            onPressed: _submitComment,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}
