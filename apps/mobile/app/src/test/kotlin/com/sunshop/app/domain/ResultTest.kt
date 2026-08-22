package com.sunshop.app.domain

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/**
 * `runCatchingApi` is the single place where transport and API failures are
 * told apart, and every screen branches on the answer, so each arm is pinned
 * here.
 */
class ResultTest {

    private fun httpException(status: Int, body: String): HttpException =
        HttpException(
            Response.error<Unit>(status, body.toResponseBody("application/json".toMediaType())),
        )

    @Test
    fun `returns Success wrapping the block's value`() {
        val result = runCatchingApi { 42 }

        assertEquals(Result.Success(42), result)
    }

    @Test
    fun `maps IOException to NetworkError`() {
        val result = runCatchingApi<Int> { throw IOException("no route to host") }

        assertSame(Result.NetworkError, result)
    }

    @Test
    fun `maps a subclass of IOException to NetworkError`() {
        // Timeouts arrive as SocketTimeoutException; they are a retry, not a rejection.
        val result = runCatchingApi<Int> { throw java.net.SocketTimeoutException("timeout") }

        assertSame(Result.NetworkError, result)
    }

    @Test
    fun `parses the server's error envelope into Failure`() {
        val body = """
            {"ok":false,"error":{"code":"OUT_OF_STOCK","message":"Size M is sold out."}}
        """.trimIndent()

        val result = runCatchingApi<Int> { throw httpException(409, body) }

        val failure = result as Result.Failure
        assertEquals("OUT_OF_STOCK", failure.code)
        assertEquals("Size M is sold out.", failure.message)
        assertEquals(409, failure.status)
        assertNull(failure.retryAfterSeconds)
    }

    @Test
    fun `carries retryAfter through so the UI can back off`() {
        val body = """
            {"ok":false,"error":{"code":"RATE_LIMITED","message":"Slow down.","retryAfter":30}}
        """.trimIndent()

        val result = runCatchingApi<Int> { throw httpException(429, body) }

        val failure = result as Result.Failure
        assertEquals("RATE_LIMITED", failure.code)
        assertEquals(30, failure.retryAfterSeconds)
    }

    @Test
    fun `ignores unknown fields rather than losing the error`() {
        // The server may add fields the app has not shipped support for yet.
        val body = """
            {"ok":false,"error":{"code":"FORBIDDEN","message":"Nope.","somethingNew":true}}
        """.trimIndent()

        val result = runCatchingApi<Int> { throw httpException(403, body) }

        assertEquals("FORBIDDEN", (result as Result.Failure).code)
    }

    @Test
    fun `falls back to INTERNAL_ERROR when the body is not an envelope`() {
        // An HTML error page from a proxy must not crash the parse path.
        val result = runCatchingApi<Int> { throw httpException(502, "<html>Bad Gateway</html>") }

        val failure = result as Result.Failure
        assertEquals("INTERNAL_ERROR", failure.code)
        assertEquals(502, failure.status)
    }

    @Test
    fun `onSuccess runs only for Success`() {
        var seen: Int? = null
        Result.Success(7).onSuccess { seen = it }
        assertEquals(7, seen)

        seen = null
        (Result.NetworkError as Result<Int>).onSuccess { seen = it }
        assertNull(seen)
    }

    @Test
    fun `onFailure reports both failure shapes`() {
        val messages = mutableListOf<String>()

        Result.Failure(code = "X", message = "boom", status = 500).onFailure { messages += it }
        (Result.NetworkError as Result<Int>).onFailure { messages += it }
        Result.Success(1).onFailure { messages += it }

        assertEquals(listOf("boom", "network"), messages)
    }

    @Test
    fun `getOrNull unwraps only Success`() {
        assertEquals(3, Result.Success(3).getOrNull())
        assertNull((Result.NetworkError as Result<Int>).getOrNull())
        assertNull(Result.Failure(code = "X", message = "m", status = 400).getOrNull())
    }
}
