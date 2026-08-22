package com.sunshop.app.data.repository

import com.sunshop.app.data.remote.AddToCartRequest
import com.sunshop.app.data.remote.CartDto
import com.sunshop.app.data.remote.SunshopApi
import com.sunshop.app.data.remote.UpdateCartItemRequest
import com.sunshop.app.domain.Result
import com.sunshop.app.domain.runCatchingApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Cart state.
 *
 * Every mutation returns the server's authoritative cart, which is published
 * to `cart`: so the badge in the bottom bar and the cart screen can never
 * disagree, and no screen recomputes totals locally.
 */
@Singleton
class CartRepository @Inject constructor(
    private val api: SunshopApi,
) {
    private val _cart = MutableStateFlow<CartDto?>(null)
    val cart: StateFlow<CartDto?> = _cart.asStateFlow()

    suspend fun refresh(): Result<CartDto> = runCatchingApi {
        api.getCart().data.also { _cart.value = it }
    }

    suspend fun add(productId: String, variantId: String, quantity: Int = 1): Result<CartDto> =
        runCatchingApi {
            api.addToCart(AddToCartRequest(productId, variantId, quantity)).data
                .also { _cart.value = it }
        }

    suspend fun updateQuantity(itemId: String, quantity: Int): Result<CartDto> = runCatchingApi {
        api.updateCartItem(itemId, UpdateCartItemRequest(quantity)).data.also { _cart.value = it }
    }

    suspend fun remove(itemId: String): Result<CartDto> = runCatchingApi {
        api.removeCartItem(itemId).data.also { _cart.value = it }
    }

    fun itemCount(): Int = _cart.value?.totals?.itemCount ?: 0
}
