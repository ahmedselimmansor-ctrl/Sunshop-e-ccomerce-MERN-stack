package com.sunshop.app.data.repository

import com.sunshop.app.data.auth.TokenStore
import com.sunshop.app.data.remote.LoginRequest
import com.sunshop.app.data.remote.SessionUserDto
import com.sunshop.app.data.remote.SunshopApi
import com.sunshop.app.domain.Result
import com.sunshop.app.domain.runCatchingApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val api: SunshopApi,
    private val tokenStore: TokenStore,
) {
    private val _user = MutableStateFlow<SessionUserDto?>(null)
    val user: StateFlow<SessionUserDto?> = _user.asStateFlow()

    val isSignedIn: Boolean get() = tokenStore.isSignedIn()

    /**
     * Called at startup. A stored refresh token is not proof of a live session
     *: it may have been revoked: so the app confirms with `/auth/me` before
     * showing signed-in UI.
     */
    suspend fun restore(): Result<SessionUserDto?> = runCatchingApi {
        if (!tokenStore.isSignedIn()) return@runCatchingApi null
        api.me().data.also { _user.value = it }
    }

    suspend fun login(email: String, password: String, totpCode: String? = null): Result<SessionUserDto> =
        runCatchingApi {
            val response = api.login(LoginRequest(email, password, totpCode = totpCode)).data
            tokenStore.save(response.tokens.accessToken, response.tokens.refreshToken)
            response.user.also { _user.value = it }
        }

    suspend fun logout() {
        runCatching { api.logout() }
        tokenStore.clear()
        _user.value = null
    }
}
