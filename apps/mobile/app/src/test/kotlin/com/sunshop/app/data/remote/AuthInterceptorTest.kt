package com.sunshop.app.data.remote

import com.sunshop.app.data.auth.TokenStore
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * The interceptor is the only place the app talks about credentials, and the
 * refresh path is the part that can quietly sign everyone out: the API rotates
 * refresh tokens, so a duplicated refresh is treated as a replay and revokes
 * the whole session family. These tests pin the header contract and every
 * branch of the 401 handling.
 */
class AuthInterceptorTest {

    private lateinit var server: MockWebServer
    private lateinit var tokenStore: TokenStore
    private lateinit var api: SunshopApi
    private lateinit var client: OkHttpClient

    private fun authEnvelope(access: String, refresh: String) =
        ApiEnvelope(
            ok = true,
            data = AuthResponseDto(
                user = SessionUserDto(id = "u1", email = "a@b.c", firstName = "A", lastName = "B"),
                tokens = TokensDto(accessToken = access, refreshToken = refresh, expiresIn = 900),
            ),
        )

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        tokenStore = mockk(relaxed = true)
        api = mockk()
        every { tokenStore.accessToken() } returns null
        every { tokenStore.refreshToken() } returns null
        every { tokenStore.cartToken() } returns null

        val interceptor = AuthInterceptor(tokenStore, dagger.Lazy { api })
        client = OkHttpClient.Builder().addInterceptor(interceptor).build()
    }

    @After
    fun tearDown() = server.shutdown()

    private fun call() = client.newCall(Request.Builder().url(server.url("/products")).build()).execute()

    @Test
    fun `sends Accept and X-Locale on every request`() {
        server.enqueue(MockResponse().setResponseCode(200))

        call().close()

        val sent = server.takeRequest()
        assertEquals("application/json", sent.getHeader("Accept"))
        assertEquals(2, sent.getHeader("X-Locale")?.length)
    }

    @Test
    fun `attaches the access token when one is stored`() {
        every { tokenStore.accessToken() } returns "token-abc"
        server.enqueue(MockResponse().setResponseCode(200))

        call().close()

        assertEquals("Bearer token-abc", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `omits Authorization entirely for a signed-out user`() {
        server.enqueue(MockResponse().setResponseCode(200))

        call().close()

        assertNull(server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `forwards the guest cart token`() {
        every { tokenStore.cartToken() } returns "cart-42"
        server.enqueue(MockResponse().setResponseCode(200))

        call().close()

        assertEquals("cart-42", server.takeRequest().getHeader("X-Cart-Token"))
    }

    @Test
    fun `persists a cart token handed back by the server`() {
        // A guest basket has to survive an app restart, so the token the API
        // issues on first contact is written back to the store.
        server.enqueue(MockResponse().setResponseCode(200).setHeader("X-Cart-Token", "cart-new"))

        call().close()

        verify { tokenStore.saveCartToken("cart-new") }
    }

    @Test
    fun `refreshes once on 401 and retries with the new token`() {
        every { tokenStore.accessToken() } returnsMany listOf("stale", "stale", "fresh", "fresh")
        every { tokenStore.refreshToken() } returns "refresh-1"
        coEvery { api.refresh(any(), any()) } returns authEnvelope("fresh", "refresh-2")

        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200))

        val response = call()
        assertEquals(200, response.code)
        response.close()

        server.takeRequest()
        val retry = server.takeRequest()
        assertEquals("Bearer fresh", retry.getHeader("Authorization"))
        assertEquals("1", retry.getHeader("X-Retry"))
        verify { tokenStore.save("fresh", "refresh-2") }
    }

    @Test
    fun `does not retry a request that already carries the retry marker`() {
        // Otherwise a server returning 401 forever would loop until the app dies.
        every { tokenStore.accessToken() } returns "stale"
        every { tokenStore.refreshToken() } returns "refresh-1"
        server.enqueue(MockResponse().setResponseCode(401))

        val response = client
            .newCall(Request.Builder().url(server.url("/products")).header("X-Retry", "1").build())
            .execute()

        assertEquals(401, response.code)
        response.close()
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `signs out when the refresh itself fails`() {
        every { tokenStore.accessToken() } returns "stale"
        every { tokenStore.refreshToken() } returns "refresh-1"
        coEvery { api.refresh(any(), any()) } throws RuntimeException("refresh rejected")

        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))

        call().close()

        verify { tokenStore.clear() }
    }

    @Test
    fun `does not attempt a refresh with no refresh token`() {
        every { tokenStore.accessToken() } returns "stale"
        every { tokenStore.refreshToken() } returns null

        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(401))

        val response = call()
        assertEquals(401, response.code)
        response.close()
    }

    @Test
    fun `leaves a successful response untouched`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true}"""))

        val response = call()
        assertEquals(200, response.code)
        response.close()

        assertEquals(1, server.requestCount)
    }
}
