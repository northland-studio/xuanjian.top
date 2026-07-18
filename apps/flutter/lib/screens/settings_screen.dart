import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/auth_provider.dart';
import '../services/auth_service.dart';
import '../config/theme.dart';
import '../widgets/apple_button.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _authService = AuthService();

  // Profile form
  final _nicknameController = TextEditingController();
  final _emailController = TextEditingController();
  final _profileFormKey = GlobalKey<FormState>();
  bool _profileLoading = false;

  // Password form
  final _oldPasswordController = TextEditingController();
  final _newPasswordController = TextEditingController();
  final _confirmNewPasswordController = TextEditingController();
  final _passwordFormKey = GlobalKey<FormState>();
  bool _passwordLoading = false;

  bool _obscureOld = true;
  bool _obscureNew = true;
  bool _obscureConfirm = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);

    // 从路由参数读取初始 tab
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final args = ModalRoute.of(context)?.settings.arguments;
      if (args is Map && args['tab'] == 1) {
        _tabController.animateTo(1);
      }
      _loadUserData();
    });
  }

  void _loadUserData() {
    final user = context.read<AuthProvider>().user;
    if (user != null) {
      _nicknameController.text = user.username;
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    _nicknameController.dispose();
    _emailController.dispose();
    _oldPasswordController.dispose();
    _newPasswordController.dispose();
    _confirmNewPasswordController.dispose();
    super.dispose();
  }

  Future<void> _updateProfile() async {
    if (!_profileFormKey.currentState!.validate()) return;

    setState(() => _profileLoading = true);

    try {
      await _authService.updateProfile({
        'nickname': _nicknameController.text.trim(),
        'email': _emailController.text.trim(),
      });
      if (!mounted) return;
      await context.read<AuthProvider>().fetchMe();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('资料更新成功'),
          backgroundColor: Colors.green.shade700,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('更新失败: $e'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    } finally {
      if (mounted) setState(() => _profileLoading = false);
    }
  }

  Future<void> _changePassword() async {
    if (!_passwordFormKey.currentState!.validate()) return;

    setState(() => _passwordLoading = true);

    try {
      await _authService.updateProfile({
        'old_password': _oldPasswordController.text,
        'new_password': _newPasswordController.text,
      });
      if (!mounted) return;
      _oldPasswordController.clear();
      _newPasswordController.clear();
      _confirmNewPasswordController.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('密码修改成功'),
          backgroundColor: Colors.green.shade700,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('密码修改失败: $e'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    } finally {
      if (mounted) setState(() => _passwordLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('设置'),
        centerTitle: true,
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppleTheme.appleBlue,
          labelColor: AppleTheme.appleBlue,
          unselectedLabelColor: AppleTheme.textSecondary,
          labelStyle: GoogleFonts.inter(
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
          unselectedLabelStyle: GoogleFonts.inter(
            fontSize: 15,
            fontWeight: FontWeight.w400,
          ),
          tabs: const [
            Tab(text: '修改资料'),
            Tab(text: '修改密码'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildProfileTab(),
          _buildPasswordTab(),
        ],
      ),
    );
  }

  Widget _buildProfileTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Form(
        key: _profileFormKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            Text(
              '个人资料',
              style: GoogleFonts.inter(
                fontSize: 21,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '修改你的昵称和邮箱地址',
              style: GoogleFonts.inter(
                fontSize: 14,
                color: AppleTheme.textSecondary,
              ),
            ),
            const SizedBox(height: 28),
            // Nickname
            _buildLabel('昵称'),
            const SizedBox(height: 8),
            _buildTextField(
              controller: _nicknameController,
              hint: '输入昵称',
              validator: (v) {
                if (v == null || v.trim().isEmpty) return '请输入昵称';
                return null;
              },
            ),
            const SizedBox(height: 20),
            // Email
            _buildLabel('邮箱'),
            const SizedBox(height: 8),
            _buildTextField(
              controller: _emailController,
              hint: '输入邮箱',
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 32),
            AppleButton.primary(
              label: '保存修改',
              isLoading: _profileLoading,
              onPressed: _updateProfile,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPasswordTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Form(
        key: _passwordFormKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            Text(
              '修改密码',
              style: GoogleFonts.inter(
                fontSize: 21,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '请确保新密码足够安全',
              style: GoogleFonts.inter(
                fontSize: 14,
                color: AppleTheme.textSecondary,
              ),
            ),
            const SizedBox(height: 28),
            // Old Password
            _buildLabel('当前密码'),
            const SizedBox(height: 8),
            _buildTextField(
              controller: _oldPasswordController,
              hint: '输入当前密码',
              obscure: _obscureOld,
              suffixIcon: IconButton(
                icon: Icon(
                  _obscureOld
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                  size: 20,
                ),
                onPressed: () => setState(() => _obscureOld = !_obscureOld),
              ),
              validator: (v) {
                if (v == null || v.isEmpty) return '请输入当前密码';
                return null;
              },
            ),
            const SizedBox(height: 20),
            // New Password
            _buildLabel('新密码'),
            const SizedBox(height: 8),
            _buildTextField(
              controller: _newPasswordController,
              hint: '输入新密码',
              obscure: _obscureNew,
              suffixIcon: IconButton(
                icon: Icon(
                  _obscureNew
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                  size: 20,
                ),
                onPressed: () => setState(() => _obscureNew = !_obscureNew),
              ),
              validator: (v) {
                if (v == null || v.isEmpty) return '请输入新密码';
                if (v.length < 6) return '新密码至少6个字符';
                return null;
              },
            ),
            const SizedBox(height: 20),
            // Confirm New Password
            _buildLabel('确认新密码'),
            const SizedBox(height: 8),
            _buildTextField(
              controller: _confirmNewPasswordController,
              hint: '再次输入新密码',
              obscure: _obscureConfirm,
              suffixIcon: IconButton(
                icon: Icon(
                  _obscureConfirm
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined,
                  size: 20,
                ),
                onPressed: () =>
                    setState(() => _obscureConfirm = !_obscureConfirm),
              ),
              validator: (v) {
                if (v == null || v.isEmpty) return '请确认新密码';
                if (v != _newPasswordController.text) return '两次密码不一致';
                return null;
              },
            ),
            const SizedBox(height: 32),
            AppleButton.primary(
              label: '修改密码',
              isLoading: _passwordLoading,
              onPressed: _changePassword,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLabel(String text) {
    return Text(
      text,
      style: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: AppleTheme.textSecondary,
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String hint,
    bool obscure = false,
    Widget? suffixIcon,
    String? Function(String?)? validator,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return TextFormField(
      controller: controller,
      obscureText: obscure,
      keyboardType: keyboardType,
      style: GoogleFonts.inter(fontSize: 17),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: GoogleFonts.inter(
          color: AppleTheme.textTertiary,
          fontSize: 17,
        ),
        suffixIcon: suffixIcon,
        filled: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppleTheme.dividerColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppleTheme.dividerColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppleTheme.appleBlue, width: 2),
        ),
      ),
      validator: validator,
      textInputAction: TextInputAction.next,
    );
  }
}
