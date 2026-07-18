import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import '../providers/auth_provider.dart';
import '../services/auth_service.dart';
import '../config/theme.dart';
import '../widgets/apple_button.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _usernameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _codeController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  final _authService = AuthService();
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  bool _isLoading = false;
  bool _isSendingCode = false;
  int _countdown = 0;

  @override
  void dispose() {
    _usernameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final email = _emailController.text.trim();
    if (email.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('请先输入邮箱地址'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    setState(() {
      _isSendingCode = true;
    });

    try {
      await _authService.sendCode(email);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('验证码已发送'),
          backgroundColor: Colors.green.shade700,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
      setState(() {
        _countdown = 60;
      });
      _startCountdown();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('发送失败: $e'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSendingCode = false;
        });
      }
    }
  }

  void _startCountdown() {
    Future.delayed(const Duration(seconds: 1), () {
      if (!mounted) return;
      if (_countdown > 0) {
        setState(() {
          _countdown--;
        });
        _startCountdown();
      }
    });
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
    });

    try {
      final data = await _authService.register(
        _usernameController.text.trim(),
        _passwordController.text,
        _emailController.text.trim(),
        code: _codeController.text.trim().isNotEmpty
            ? _codeController.text.trim()
            : null,
      );

      if (!mounted) return;

      // 注册成功后自动登录
      final authProvider = context.read<AuthProvider>();
      final token = data['token'];
      // 触发 AuthProvider 刷新用户信息
      await authProvider.fetchMe();

      if (!mounted) return;

      Navigator.pushReplacementNamed(context, '/home');
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('注册失败: $e'),
          backgroundColor: Colors.red.shade700,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color(0xFF1A1A2E),
              Color(0xFF16213E),
              Color(0xFF0F3460),
            ],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SizedBox(height: 20),
                    // App Icon
                    Container(
                      width: 80,
                      height: 80,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            AppleTheme.appleBlue,
                            AppleTheme.brightBlue,
                          ],
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: AppleTheme.appleBlue.withAlpha(77),
                            blurRadius: 20,
                            spreadRadius: 3,
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.shield,
                        size: 44,
                        color: AppleTheme.white,
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      '创建账号',
                      style: GoogleFonts.inter(
                        fontSize: 28,
                        fontWeight: FontWeight.w700,
                        color: AppleTheme.white,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '加入玄剑公会',
                      style: GoogleFonts.inter(
                        fontSize: 15,
                        fontWeight: FontWeight.w400,
                        color: AppleTheme.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 36),
                    // Username
                    _buildField(
                      controller: _usernameController,
                      hint: '用户名',
                      icon: Icons.person_outline,
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return '请输入用户名';
                        if (v.trim().length < 2) return '用户名至少2个字符';
                        return null;
                      },
                    ),
                    const SizedBox(height: 14),
                    // Email
                    _buildField(
                      controller: _emailController,
                      hint: '邮箱',
                      icon: Icons.email_outlined,
                      keyboardType: TextInputType.emailAddress,
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return '请输入邮箱';
                        if (!v.contains('@')) return '请输入有效的邮箱地址';
                        return null;
                      },
                    ),
                    const SizedBox(height: 14),
                    // Verification Code
                    Row(
                      children: [
                        Expanded(
                          child: _buildField(
                            controller: _codeController,
                            hint: '验证码',
                            icon: Icons.pin_outlined,
                            keyboardType: TextInputType.number,
                          ),
                        ),
                        const SizedBox(width: 12),
                        SizedBox(
                          height: 50,
                          child: ElevatedButton(
                            onPressed:
                                (_isSendingCode || _countdown > 0)
                                    ? null
                                    : _sendCode,
                            style: ElevatedButton.styleFrom(
                              backgroundColor:
                                  AppleTheme.appleBlue.withAlpha(200),
                              foregroundColor: AppleTheme.white,
                              disabledBackgroundColor:
                                  Colors.white.withAlpha(30),
                              disabledForegroundColor:
                                  AppleTheme.textSecondary,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            child: Text(
                              _countdown > 0
                                  ? '${_countdown}s'
                                  : '发送验证码',
                              style: GoogleFonts.inter(
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    // Password
                    _buildField(
                      controller: _passwordController,
                      hint: '密码',
                      icon: Icons.lock_outline,
                      obscure: _obscurePassword,
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscurePassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          color: AppleTheme.textSecondary,
                        ),
                        onPressed: () {
                          setState(() {
                            _obscurePassword = !_obscurePassword;
                          });
                        },
                      ),
                      validator: (v) {
                        if (v == null || v.isEmpty) return '请输入密码';
                        if (v.length < 6) return '密码至少6个字符';
                        return null;
                      },
                    ),
                    const SizedBox(height: 14),
                    // Confirm Password
                    _buildField(
                      controller: _confirmPasswordController,
                      hint: '确认密码',
                      icon: Icons.lock_outline,
                      obscure: _obscureConfirmPassword,
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscureConfirmPassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          color: AppleTheme.textSecondary,
                        ),
                        onPressed: () {
                          setState(() {
                            _obscureConfirmPassword =
                                !_obscureConfirmPassword;
                          });
                        },
                      ),
                      validator: (v) {
                        if (v == null || v.isEmpty) return '请确认密码';
                        if (v != _passwordController.text) return '两次密码不一致';
                        return null;
                      },
                    ),
                    const SizedBox(height: 28),
                    // Register Button
                    AppleButton.primary(
                      label: '注册',
                      isLoading: _isLoading,
                      onPressed: _handleRegister,
                    ),
                    const SizedBox(height: 20),
                    // Login Link
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          '已有账号？',
                          style: GoogleFonts.inter(
                            fontSize: 14,
                            color: AppleTheme.textSecondary,
                          ),
                        ),
                        GestureDetector(
                          onTap: () {
                            Navigator.pop(context);
                          },
                          child: Text(
                            '立即登录',
                            style: GoogleFonts.inter(
                              fontSize: 14,
                              color: AppleTheme.brightBlue,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 30),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildField({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    bool obscure = false,
    Widget? suffixIcon,
    String? Function(String?)? validator,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return TextFormField(
      controller: controller,
      obscureText: obscure,
      keyboardType: keyboardType,
      style: GoogleFonts.inter(
        fontSize: 17,
        color: AppleTheme.white,
      ),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: GoogleFonts.inter(
          color: AppleTheme.textTertiary,
        ),
        prefixIcon: Icon(icon, color: AppleTheme.textSecondary),
        suffixIcon: suffixIcon,
        filled: true,
        fillColor: Colors.white.withAlpha(20),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 14,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(
            color: AppleTheme.appleBlue,
            width: 2,
          ),
        ),
      ),
      validator: validator,
      textInputAction: TextInputAction.next,
    );
  }
}
