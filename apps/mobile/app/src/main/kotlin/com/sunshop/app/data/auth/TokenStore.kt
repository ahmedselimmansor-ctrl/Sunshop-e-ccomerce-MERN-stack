package com.sunshop.app.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Credential storage.
 *
 * Tokens go into `EncryptedSharedPreferences`, whose master key lives in the
 * Android Keystore: hardware-backed where the device supports it. Plain
 * SharedPreferences would put a long-lived refresh token in a world-readable
 * file on a rooted device, and backup extraction rules exclude this file so a
 * cloud restore cannot resurrect a session on another handset.
 */
@Singleton
class TokenStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        FILE_NAME,
        MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun accessToken(): String? = prefs.getString(KEY_ACCESS, null)

    fun refreshToken(): String? = prefs.getString(KEY_REFRESH, null)

    fun cartToken(): String? = prefs.getString(KEY_CART, null)

    fun save(accessToken: String, refreshToken: String?) {
        prefs.edit().apply {
            putString(KEY_ACCESS, accessToken)
            // A rotation that returns no new refresh token keeps the old one.
            if (refreshToken != null) putString(KEY_REFRESH, refreshToken)
            apply()
        }
    }

    fun saveCartToken(token: String) {
        prefs.edit().putString(KEY_CART, token).apply()
    }

    fun clear() {
        // The cart token survives sign-out on purpose: a guest basket should
        // not evaporate because someone logged out.
        prefs.edit().remove(KEY_ACCESS).remove(KEY_REFRESH).apply()
    }

    fun isSignedIn(): Boolean = refreshToken() != null

    private companion object {
        const val FILE_NAME = "sunshop_secure_prefs"
        const val KEY_ACCESS = "access_token"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_CART = "cart_token"
    }
}
