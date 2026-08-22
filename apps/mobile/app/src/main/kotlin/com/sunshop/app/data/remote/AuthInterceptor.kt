package com.sunshop.app.data.remote

import com.sunshop.app.data.auth.TokenStore
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Interceptor
import okhttp3.Response
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Attaches the access token and transparently refreshes it once on a 401.
 *
 * The refresh is guarded by a mutex: without it, six parallel requests that all
 * expire at once would fire six refreshes, and the server's refresh-token
 * rotation would treat five of them as replays and revoke the entire session
 * family. One refresh, everyone else waits and retries with the new token.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenStore: TokenStore,
    private val api: dagger.Lazy<SunshopApi>,
) : Interceptor {

    private val refreshMutex = Mutex()

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()

        val request = original.newBuilder()
            .header("Accept", "application/json")
            // The API varies its copy and its cache on this header.
            .header("X-Locale", Locale.getDefault().language.take(2))
            .apply {
                tokenStore.accessToken()?.let { header("Authorization", "Bearer $it") }
                tokenStore.cartToken()?.let { header("X-Cart-Token", it) }
            }
            .build()

        val response = chain.proceed(request)

        // Guests are handed a cart token on first contact; keep it so the
        // basket survives an app restart.
        response.header("X-Cart-Token")?.let(tokenStore::saveCartToken)

        if (response.code != 401 || original.header("X-Retry") != null) return response

        response.close()

        val refreshed = runBlocking {
            refreshMutex.withLock {
                // Another thread may have refreshed while this one waited.
                val current = tokenStore.accessToken()
                if (current != null && current != request.header("Authorization")?.removePrefix("Bearer ")) {
                    return@withLock true
                }
                refreshToken()
            }
        }

        if (!refreshed) return chain.proceed(request)

        val retried = request.newBuilder()
            .header("X-Retry", "1")
            .header("Authorization", "Bearer ${tokenStore.accessToken()}")
            .build()

        return chain.proceed(retried)
    }

    private suspend fun refreshToken(): Boolean {
        val refresh = tokenStore.refreshToken() ?: return false
        return runCatching {
            val response = api.get().refresh(RefreshRequest(refresh))
            tokenStore.save(response.data.tokens.accessToken, response.data.tokens.refreshToken)
            true
        }.getOrElse {
            tokenStore.clear()
            false
        }
    }
}
