import 'package:flutter/material.dart';
import 'package:xuanjian_guild/config/theme.dart';

class CommentWidget extends StatelessWidget {
  final Map<String, dynamic> comment;
  final int depth;

  const CommentWidget({
    Key? key,
    required this.comment,
    this.depth = 0,
  }) : super(key: key);

  String get _authorName {
    return comment['author'] ?? comment['username'] ?? comment['author_name'] ?? '匿名用户';
  }

  String get _content {
    return comment['content'] ?? comment['body'] ?? '';
  }

  String get _createdAt {
    return comment['created_at'] ?? comment['time'] ?? '';
  }

  String? get _authorAvatar {
    return comment['author_avatar'] ?? comment['avatar'];
  }

  List<Map<String, dynamic>> get _replies {
    final replies = comment['replies'] ?? comment['children'];
    if (replies is List) {
      return replies.cast<Map<String, dynamic>>();
    }
    return [];
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (depth > 0)
            Container(
              width: 2,
              margin: const EdgeInsets.only(left: 20, top: 8, bottom: 8),
              color: AppleTheme.dividerColor,
            ),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(
                left: depth > 0 ? 12 : 0,
                top: 8,
                bottom: 8,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 18,
                        backgroundImage: _authorAvatar != null &&
                                _authorAvatar!.isNotEmpty
                            ? NetworkImage(_authorAvatar!)
                            : null,
                        child: _authorAvatar == null || _authorAvatar!.isEmpty
                            ? const Icon(Icons.person, size: 18)
                            : null,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _authorName,
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                      Text(
                        _formatTime(_createdAt),
                        style: theme.textTheme.labelSmall,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _content,
                    style: theme.textTheme.bodyLarge,
                  ),
                  if (_replies.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    ..._replies.map(
                      (reply) => CommentWidget(
                        comment: reply,
                        depth: depth + 1,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
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
}
