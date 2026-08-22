package com.sunshop.app.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire types.
 *
 * These mirror the zod schemas in `@sunshop/shared`. They are deliberately a
 * separate layer from the domain models in `domain/`: the API is allowed to
 * evolve (add a field, rename one behind a version) without that change
 * rippling into every screen.
 *
 * Money arrives as an integer of minor units plus a currency, exactly as the
 * server stores it: parsing it into a Double here would reintroduce the
 * rounding problem the server design exists to avoid.
 */
@Serializable
data class ApiEnvelope<T>(
    val ok: Boolean,
    val data: T,
)

@Serializable
data class ApiListEnvelope<T>(
    val ok: Boolean,
    val data: List<T>,
    val meta: PaginationMeta,
)

@Serializable
data class PaginationMeta(
    val page: Int,
    val limit: Int,
    val total: Int,
    val totalPages: Int,
    val hasNext: Boolean,
    val hasPrev: Boolean,
)

@Serializable
data class ApiErrorEnvelope(
    val ok: Boolean = false,
    val error: ApiErrorBody,
)

@Serializable
data class ApiErrorBody(
    val code: String,
    val message: String,
    val details: List<FieldIssue>? = null,
    val requestId: String? = null,
    val retryAfter: Int? = null,
)

@Serializable
data class FieldIssue(val path: String, val message: String)

@Serializable
data class LocalizedText(val en: String = "", val ar: String = "") {
    /** Picks the right side for the active locale, falling back to the other. */
    fun resolve(language: String): String {
        val primary = if (language.startsWith("ar")) ar else en
        if (primary.isNotBlank()) return primary
        return if (language.startsWith("ar")) en else ar
    }
}

@Serializable
data class MoneyDto(val amount: Long, val currency: String)

@Serializable
data class ImageDto(
    val key: String,
    val url: String,
    val alt: LocalizedText? = null,
)

@Serializable
data class PriceRangeDto(val min: MoneyDto, val max: MoneyDto)

@Serializable
data class RatingDto(val average: Double = 0.0, val count: Int = 0)

@Serializable
data class ProductCardDto(
    val id: String,
    val name: LocalizedText,
    val slug: String,
    val brand: String? = null,
    val image: ImageDto? = null,
    val priceRange: PriceRangeDto,
    val compareAtPrice: MoneyDto? = null,
    val rating: RatingDto = RatingDto(),
    val inStock: Boolean = true,
    val badges: List<String> = emptyList(),
)

@Serializable
data class VariantDto(
    @SerialName("_id") val id: String,
    val sku: String,
    val optionValues: Map<String, String> = emptyMap(),
    val price: MoneyDto,
    val compareAtPrice: MoneyDto? = null,
    val available: Int = 0,
    val inStock: Boolean = false,
    val isLowStock: Boolean = false,
)

@Serializable
data class OptionValueDto(val code: String, val label: LocalizedText, val swatch: String? = null)

@Serializable
data class OptionDto(val code: String, val name: LocalizedText, val values: List<OptionValueDto>)

@Serializable
data class ProductDto(
    val id: String,
    val name: LocalizedText,
    val slug: String,
    val description: LocalizedText,
    val brand: String? = null,
    val images: List<ImageDto> = emptyList(),
    val options: List<OptionDto> = emptyList(),
    val variants: List<VariantDto> = emptyList(),
    val priceRange: PriceRangeDto,
    val rating: RatingDto = RatingDto(),
    val inStock: Boolean = true,
)

@Serializable
data class CartItemDto(
    val id: String,
    val productId: String,
    val variantId: String,
    val sku: String,
    val name: LocalizedText,
    val slug: String,
    val imageUrl: String? = null,
    val unitPrice: MoneyDto,
    val quantity: Int,
    val lineTotal: MoneyDto,
    val available: Int = 0,
    val inStock: Boolean = true,
)

@Serializable
data class CartTotalsDto(
    val subtotal: MoneyDto,
    val discount: MoneyDto,
    val shipping: MoneyDto,
    val tax: MoneyDto,
    val total: MoneyDto,
    val itemCount: Int,
)

@Serializable
data class CartDto(
    val id: String,
    val currency: String,
    val items: List<CartItemDto> = emptyList(),
    val totals: CartTotalsDto,
)

@Serializable
data class SessionUserDto(
    val id: String,
    val email: String,
    val firstName: String,
    val lastName: String,
    val roles: List<String> = emptyList(),
    val permissions: List<String> = emptyList(),
    val emailVerified: Boolean = false,
    val locale: String = "en",
)

@Serializable
data class TokensDto(
    val accessToken: String,
    val refreshToken: String? = null,
    val expiresIn: Int,
    val tokenType: String = "Bearer",
)

@Serializable
data class AuthResponseDto(val user: SessionUserDto, val tokens: TokensDto)

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
    val rememberMe: Boolean = true,
    val totpCode: String? = null,
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class AddToCartRequest(val productId: String, val variantId: String, val quantity: Int)

@Serializable
data class UpdateCartItemRequest(val quantity: Int)

@Serializable
data class AddressRequest(
    val fullName: String,
    val phone: String,
    val line1: String,
    val line2: String? = null,
    val city: String,
    val state: String? = null,
    val postalCode: String? = null,
    val country: String,
)

@Serializable
data class CheckoutRequest(
    val shippingAddress: AddressRequest,
    val billingSameAsShipping: Boolean = true,
    val paymentMethod: String,
    val shippingMethodId: String,
    val email: String? = null,
    val expectedTotal: MoneyDto? = null,
)

@Serializable
data class OrderItemDto(
    val sku: String,
    val name: LocalizedText,
    val imageUrl: String? = null,
    val quantity: Int,
    val lineTotal: MoneyDto,
)

@Serializable
data class OrderDto(
    val id: String,
    val orderNumber: String,
    val status: String,
    val paymentStatus: String,
    val currency: String,
    val items: List<OrderItemDto> = emptyList(),
    val totals: CartTotalsDto,
    val placedAt: String,
)
