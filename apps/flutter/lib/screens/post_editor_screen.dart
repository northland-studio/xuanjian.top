import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/post_provider.dart';
import '../widgets/glass_app_bar.dart';
import '../widgets/apple_button.dart';
import '../config/theme.dart';

class PostEditorScreen extends StatefulWidget {
  final int? postId;
  final String? initialTitle;
  final String? initialContent;
  final String? initialType;

  const PostEditorScreen({
    super.key,
    this.postId,
    this.initialTitle,
    this.initialContent,
    this.initialType,
  });

  bool get isEditing => postId != null;

  @override
  State<PostEditorScreen> createState() => _PostEditorScreenState();
}

class _PostEditorScreenState extends State<PostEditorScreen> {
  late final TextEditingController _titleController;
  late final TextEditingController _contentController;
  String _type = 'forum';
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.initialTitle ?? '');
    _contentController =
        TextEditingController(text: widget.initialContent ?? '');
    if (widget.initialType != null) {
      _type = widget.initialType!;
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final title = _titleController.text.trim();
    final content = _contentController.text.trim();

    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入标题')),
      );
      return;
    }
    if (content.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入内容')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    final postProvider = context.read<PostProvider>();
    final success = await postProvider.createPost(title, content, _type);

    if (mounted) {
      setState(() => _isSubmitting = false);
      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('发布成功')),
        );
        Navigator.of(context).pop(true);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(postProvider.error ?? '发布失败')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: GlassAppBar(
        title: widget.isEditing ? '编辑帖子' : '发布帖子',
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Type dropdown
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              decoration: BoxDecoration(
                color: theme.cardColor,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppleTheme.dividerColor),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _type,
                  isExpanded: true,
                  items: const [
                    DropdownMenuItem(value: 'daily', child: Text('公会日报')),
                    DropdownMenuItem(value: 'decision', child: Text('决策公示')),
                    DropdownMenuItem(value: 'forum', child: Text('公会贴吧')),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => _type = value);
                  },
                ),
              ),
            ),
            const SizedBox(height: 16),
            // Title
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                hintText: '标题',
              ),
              style: theme.textTheme.titleLarge,
              maxLength: 100,
            ),
            const SizedBox(height: 12),
            // Content
            TextField(
              controller: _contentController,
              decoration: const InputDecoration(
                hintText: '内容 (支持 Markdown)',
                alignLabelWithHint: true,
              ),
              maxLines: 12,
              minLines: 6,
              style: theme.textTheme.bodyLarge,
            ),
            const SizedBox(height: 24),
            // Submit button
            AppleButton.primary(
              label: widget.isEditing ? '保存修改' : '发布',
              isLoading: _isSubmitting,
              onPressed: _submit,
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}
