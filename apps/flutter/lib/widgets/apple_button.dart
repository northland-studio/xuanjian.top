import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/theme.dart';

class AppleButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final Color? backgroundColor;
  final Color? textColor;

  const AppleButton({
    super.key,
    required this.label,
    this.onPressed,
    this.isLoading = false,
    this.backgroundColor,
    this.textColor,
  });

  const AppleButton.primary({
    super.key,
    required String label,
    VoidCallback? onPressed,
    bool isLoading = false,
  }) : this(
          label: label,
          onPressed: onPressed,
          isLoading: isLoading,
          backgroundColor: AppleTheme.appleBlue,
          textColor: AppleTheme.white,
        );

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 50,
      child: ElevatedButton(
        onPressed: isLoading ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: backgroundColor ?? AppleTheme.appleBlue,
          foregroundColor: textColor ?? AppleTheme.white,
          disabledBackgroundColor:
              (backgroundColor ?? AppleTheme.appleBlue).withAlpha(128),
          disabledForegroundColor:
              (textColor ?? AppleTheme.white).withAlpha(128),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        child: isLoading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppleTheme.white,
                ),
              )
            : Text(
                label,
                style: GoogleFonts.inter(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  color: textColor ?? AppleTheme.white,
                ),
              ),
      ),
    );
  }
}
