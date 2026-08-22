package com.sunshop.app

import androidx.lifecycle.ViewModel
import com.sunshop.app.data.settings.SettingsRepository
import com.sunshop.app.ui.theme.ThemePreference
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    settings: SettingsRepository,
) : ViewModel() {
    val theme: Flow<ThemePreference> = settings.theme
}
