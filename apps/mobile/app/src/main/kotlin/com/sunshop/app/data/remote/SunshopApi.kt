package com.sunshop.app.data.remote

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * REST surface.
 *
 * Suspend functions rather than `Call`: every caller is inside a coroutine
 * already, and cancellation then propagates for free when a screen leaves the
 * composition mid-request.
 */
interface SunshopApi {

    // ── Catalogue ───────────────────────────────────────────────────────────

    @GET("products")
    suspend fun getProducts(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20,
        @Query("category") category: String? = null,
        @Query("sort") sort: String = "relevance",
        @Query("featured") featured: Boolean? = null,
    ): ApiListEnvelope<ProductCardDto>

    @GET("search")
    suspend fun search(
        @Query("q") query: String,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20,
    ): ApiListEnvelope<ProductCardDto>

    @GET("products/{idOrSlug}")
    suspend fun getProduct(@Path("idOrSlug") idOrSlug: String): ApiEnvelope<ProductDto>

    // ── Cart ────────────────────────────────────────────────────────────────

    @GET("cart")
    suspend fun getCart(): ApiEnvelope<CartDto>

    @POST("cart/items")
    suspend fun addToCart(@Body body: AddToCartRequest): ApiEnvelope<CartDto>

    @PATCH("cart/items/{itemId}")
    suspend fun updateCartItem(
        @Path("itemId") itemId: String,
        @Body body: UpdateCartItemRequest,
    ): ApiEnvelope<CartDto>

    @DELETE("cart/items/{itemId}")
    suspend fun removeCartItem(@Path("itemId") itemId: String): ApiEnvelope<CartDto>

    // ── Auth ────────────────────────────────────────────────────────────────

    @POST("auth/login")
    suspend fun login(
        @Body body: LoginRequest,
        /**
         * Tells the API to return the refresh token in the body instead of an
         * httpOnly cookie: a native client has no cookie jar worth trusting,
         * and stores it in the Android Keystore instead.
         */
        @Header("X-Client-Type") clientType: String = "mobile",
    ): ApiEnvelope<AuthResponseDto>

    @POST("auth/refresh")
    suspend fun refresh(
        @Body body: RefreshRequest,
        @Header("X-Client-Type") clientType: String = "mobile",
    ): ApiEnvelope<AuthResponseDto>

    @POST("auth/logout")
    suspend fun logout(@Body body: Map<String, Boolean> = mapOf("allDevices" to false))

    @GET("auth/me")
    suspend fun me(): ApiEnvelope<SessionUserDto>

    // ── Orders ──────────────────────────────────────────────────────────────

    @POST("orders/checkout")
    suspend fun checkout(
        @Body body: CheckoutRequest,
        /** Required: a retry on a flaky mobile network must not order twice. */
        @Header("X-Idempotency-Key") idempotencyKey: String,
    ): ApiEnvelope<OrderDto>

    @GET("orders")
    suspend fun getOrders(
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 20,
    ): ApiListEnvelope<OrderDto>

    @GET("orders/{idOrNumber}")
    suspend fun getOrder(@Path("idOrNumber") idOrNumber: String): ApiEnvelope<OrderDto>
}
