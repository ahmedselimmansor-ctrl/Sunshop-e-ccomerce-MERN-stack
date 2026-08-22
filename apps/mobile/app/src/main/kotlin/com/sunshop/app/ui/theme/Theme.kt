package com.sunshop.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

enum class ThemePreference { LIGHT, DARK, SYSTEM }

/**
 * Sunshop's amber identity, expressed as a Material 3 colour scheme.
 *
 * The dark scheme is not the light one inverted: the primary is lightened so it
 * still passes contrast against a dark surface, and `onPrimary` stays near-black
 * because white text on amber fails at every weight.
 */
private val SunshopAmber = Color(0xFFF59E0B)
private val SunshopAmberLight = Color(0xFFFBBF24)

private val LightColors = lightColorScheme(
    primary = SunshopAmber,
    onPrimary = Color(0xFF1C1207),
    primaryContainer = Color(0xFFFEF3C7),
    onPrimaryContainer = Color(0xFF422006),
    secondary = Color(0xFF475569),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF0F172A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = Color(0xFF475569),
    error = Color(0xFFB91C1C),
    outline = Color(0xFFCBD5E1),
)

private val DarkColors = darkColorScheme(
    primary = SunshopAmberLight,
    onPrimary = Color(0xFF1C1207),
    primaryContainer = Color(0xFF78350F),
    onPrimaryContainer = Color(0xFFFEF3C7),
    secondary = Color(0xFF94A3B8),
    background = Color(0xFF0B1120),
    onBackground = Color(0xFFE2E8F0),
    surface = Color(0xFF111827),
    onSurface = Color(0xFFE2E8F0),
    surfaceVariant = Color(0xFF1E293B),
    onSurfaceVariant = Color(0xFFCBD5E1),
    error = Color(0xFFF87171),
    outline = Color(0xFF334155),
)

@Composable
fun SunshopTheme(
    preference: ThemePreference = ThemePreference.SYSTEM,
    /**
     * Material You is opt-*out* rather than opt-in: on Android 12+ most users
     * expect apps to pick up their wallpaper palette. Brand-critical surfaces
     * still use the amber above.
     */
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val dark = when (preference) {
        ThemePreference.LIGHT -> false
        ThemePreference.DARK -> true
        ThemePreference.SYSTEM -> isSystemInDarkTheme()
    }

    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        dark -> DarkColors
        else -> LightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = SunshopTypography,
        content = content,
    )
}
