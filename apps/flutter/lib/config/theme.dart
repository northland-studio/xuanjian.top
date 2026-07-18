import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Apple Design System 主题配置
/// 参考 DESIGN.md & SKILL.md
class AppleTheme {
  AppleTheme._();

  // ─── Color Palette ───
  static const Color pureBlack = Color(0xFF000000);
  static const Color lightGray = Color(0xFFF5F5F7);
  static const Color nearBlack = Color(0xFF1D1D1F);
  static const Color appleBlue = Color(0xFF0071E3);
  static const Color linkBlue = Color(0xFF0066CC);
  static const Color brightBlue = Color(0xFF2997FF);
  static const Color white = Color(0xFFFFFFFF);
  static const Color textSecondary = Color(0xFF86868B);
  static const Color textTertiary = Color(0xFFAEAEB2);
  static const Color darkSurface = Color(0xFF272729);
  static const Color darkSurface2 = Color(0xFF2A2A2D);
  static const Color cardShadow = Color(0x382E2E33);
  static const Color navGlass = Color(0xCC000000);
  static const Color dividerColor = Color(0xFFE5E5EA);

  // ─── Typography ───
  static TextTheme _buildTextTheme(Color textColor) {
    return TextTheme(
      // Display Hero: 56px, weight 600, tight
      displayLarge: GoogleFonts.inter(
        fontSize: 56,
        fontWeight: FontWeight.w600,
        height: 1.07,
        letterSpacing: -0.28,
        color: textColor,
      ),
      // Section Heading: 40px, weight 600
      headlineLarge: GoogleFonts.inter(
        fontSize: 40,
        fontWeight: FontWeight.w600,
        height: 1.10,
        color: textColor,
      ),
      // Tile Heading: 28px, weight 400
      headlineMedium: GoogleFonts.inter(
        fontSize: 28,
        fontWeight: FontWeight.w400,
        height: 1.14,
        letterSpacing: 0.196,
        color: textColor,
      ),
      // Card Title: 21px, weight 700
      titleLarge: GoogleFonts.inter(
        fontSize: 21,
        fontWeight: FontWeight.w700,
        height: 1.19,
        letterSpacing: 0.231,
        color: textColor,
      ),
      // Sub-heading: 21px, weight 400
      titleMedium: GoogleFonts.inter(
        fontSize: 21,
        fontWeight: FontWeight.w400,
        height: 1.19,
        letterSpacing: 0.231,
        color: textColor,
      ),
      // Body: 17px, weight 400
      bodyLarge: GoogleFonts.inter(
        fontSize: 17,
        fontWeight: FontWeight.w400,
        height: 1.47,
        letterSpacing: -0.374,
        color: textColor,
      ),
      // Body Emphasis: 17px, weight 600
      bodyMedium: GoogleFonts.inter(
        fontSize: 17,
        fontWeight: FontWeight.w600,
        height: 1.24,
        letterSpacing: -0.374,
        color: textColor,
      ),
      // Caption: 14px
      bodySmall: GoogleFonts.inter(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        height: 1.29,
        letterSpacing: -0.224,
        color: const Color(0xCC000000),
      ),
      // Micro: 12px
      labelSmall: GoogleFonts.inter(
        fontSize: 12,
        fontWeight: FontWeight.w400,
        height: 1.33,
        letterSpacing: -0.12,
        color: const Color(0x7A000000),
      ),
    );
  }

  static ThemeData get lightTheme {
    const textColor = nearBlack;
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      scaffoldBackgroundColor: lightGray,
      colorScheme: const ColorScheme.light(
        primary: appleBlue,
        onPrimary: white,
        surface: white,
        onSurface: nearBlack,
        secondary: nearBlack,
        onSecondary: white,
      ),
      textTheme: _buildTextTheme(textColor),
      appBarTheme: AppBarTheme(
        backgroundColor: navGlass.withAlpha(204), // 0.8 opacity
        foregroundColor: white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          color: white,
          letterSpacing: -0.374,
        ),
        systemOverlayStyle: const SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.light,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: lightGray,
        surfaceTintColor: Colors.transparent,
        indicatorColor: appleBlue.withAlpha(30),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return GoogleFonts.inter(
              fontSize: 10,
              fontWeight: FontWeight.w500,
              color: appleBlue,
            );
          }
          return GoogleFonts.inter(
            fontSize: 10,
            color: textSecondary,
          );
        }),
      ),
      cardTheme: CardThemeData(
        color: white,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        shadowColor: cardShadow,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: lightGray,
        selectedColor: appleBlue,
        labelStyle: GoogleFonts.inter(fontSize: 13),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(980)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: dividerColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: dividerColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: appleBlue, width: 2),
        ),
        labelStyle: GoogleFonts.inter(
          color: textSecondary,
          fontSize: 17,
          letterSpacing: -0.374,
        ),
      ),
    );
  }

  static ThemeData get darkTheme {
    const textColor = white;
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: pureBlack,
      colorScheme: const ColorScheme.dark(
        primary: brightBlue,
        onPrimary: white,
        surface: darkSurface,
        onSurface: white,
        secondary: white,
        onSecondary: pureBlack,
      ),
      textTheme: _buildTextTheme(textColor),
      appBarTheme: AppBarTheme(
        backgroundColor: navGlass,
        foregroundColor: white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          color: white,
          letterSpacing: -0.374,
        ),
        systemOverlayStyle: const SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.light,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: nearBlack,
        surfaceTintColor: Colors.transparent,
        indicatorColor: brightBlue.withAlpha(30),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return GoogleFonts.inter(
              fontSize: 10,
              fontWeight: FontWeight.w500,
              color: brightBlue,
            );
          }
          return GoogleFonts.inter(
            fontSize: 10,
            color: textSecondary,
          );
        }),
      ),
      cardTheme: CardThemeData(
        color: darkSurface,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: darkSurface2,
        selectedColor: brightBlue,
        labelStyle: GoogleFonts.inter(fontSize: 13),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(980)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: darkSurface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: darkSurface2),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: darkSurface2),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: brightBlue, width: 2),
        ),
      ),
    );
  }

  /// Spring动画参数 (Apple Design - SKILL.md)
  static const springDefault = SpringDescription(
    mass: 1,
    stiffness: 200,
    damping: 28, // critically damped ~1.0
  );
  
  static const springBouncy = SpringDescription(
    mass: 1,
    stiffness: 200,
    damping: 22, // ~0.8 damping ratio
  );
}
