package com.sunshop.app.domain

import com.sunshop.app.data.remote.ApiErrorEnvelope
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException

/**
 * A three-state result.
 *
 * Distinguishing a transport failure from an API rejection matters at the UI
 * layer: a network blip deserves a retry button, while a 409 "out of stock"
 * deserves an explanation and a different action. Collapsing both into
 * `Exception` pushes that decision into every screen.
 */
sealed interface Result<out T> {
    data class Success<T>(val value: T) : Result<T>

    /** The API answered, and said no. */
    data class Failure(
        val code: String,
        val message: String,
        val status: Int,
        val retryAfterSeconds: Int? = null,
    ) : Result<Nothing>

    /** The API never answered: offline, DNS, timeout. */
    data object NetworkError : Result<Nothing>
}

// `internal`, not `private`: the public inline function below reads it, and an
// inline body is compiled into the caller, which could not see a private field.
@PublishedApi
internal val errorJson = Json { ignoreUnknownKeys = true }

/**
 * Wraps an API call, translating exceptions into `Result`. The server's
 * localized `message` is surfaced as-is; the stable `code` is what callers
 * branch on.
 */
inline fun <T> runCatchingApi(block: () -> T): Result<T> = try {
    Result.Success(block())
} catch (io: IOException) {
    Result.NetworkError
} catch (http: HttpException) {
    val body = http.response()?.errorBody()?.string()
    val parsed = body?.let {
        runCatching { errorJson.decodeFromString<ApiErrorEnvelope>(it) }.getOrNull()
    }
    Result.Failure(
        code = parsed?.error?.code ?: "INTERNAL_ERROR",
        message = parsed?.error?.message ?: http.message(),
        status = http.code(),
        retryAfterSeconds = parsed?.error?.retryAfter,
    )
}

inline fun <T> Result<T>.onSuccess(action: (T) -> Unit): Result<T> {
    if (this is Result.Success) action(value)
    return this
}

inline fun <T> Result<T>.onFailure(action: (message: String) -> Unit): Result<T> {
    when (this) {
        is Result.Failure -> action(message)
        Result.NetworkError -> action("network")
        else -> Unit
    }
    return this
}

fun <T> Result<T>.getOrNull(): T? = (this as? Result.Success)?.value
