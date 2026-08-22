package com.sunshop.app.data.settings

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.sunshop.app.ui.theme.ThemePreference
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "sunshop_settings")

/**
 * User preferences that are not credentials.
 *
 * DataStore rather than SharedPreferences: reads are a Flow, so a theme change
 * recomposes the whole app without an observer registration, and writes are
 * transactional instead of fire-and-forget.
 */
@Singleton
class SettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val themeKey = stringPreferencesKey("theme")
    private val localeKey = stringPreferencesKey("locale")

    val theme: Flow<ThemePreference> = context.dataStore.data.map { preferences ->
        runCatching { ThemePreference.valueOf(preferences[themeKey] ?: "SYSTEM") }
            .getOrDefault(ThemePreference.SYSTEM)
    }

    /** Empty string means "follow the device language". */
    val locale: Flow<String> = context.dataStore.data.map { it[localeKey] ?: "" }

    suspend fun setTheme(preference: ThemePreference) {
        context.dataStore.edit { it[themeKey] = preference.name }
    }

    suspend fun setLocale(tag: String) {
        context.dataStore.edit { it[localeKey] = tag }
    }
}
