package com.sunshop.app.ui.screens.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunshop.app.data.remote.SessionUserDto
import com.sunshop.app.data.repository.AuthRepository
import com.sunshop.app.data.settings.SettingsRepository
import com.sunshop.app.domain.Result
import com.sunshop.app.ui.theme.ThemePreference
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AccountViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val settings: SettingsRepository,
) : ViewModel() {

    val user: StateFlow<SessionUserDto?> = auth.user
    val theme: Flow<ThemePreference> = settings.theme

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    init {
        viewModelScope.launch { auth.restore() }
    }

    fun login(email: String, password: String) = viewModelScope.launch {
        _error.value = null
        when (val result = auth.login(email, password)) {
            is Result.Failure -> _error.value = result.message
            Result.NetworkError -> _error.value = "network"
            is Result.Success -> Unit
        }
    }

    fun logout() = viewModelScope.launch { auth.logout() }

    fun setTheme(preference: ThemePreference) = viewModelScope.launch {
        settings.setTheme(preference)
    }
}
