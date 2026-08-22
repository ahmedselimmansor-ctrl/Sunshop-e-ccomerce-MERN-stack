package com.sunshop.app.data.repository

import com.sunshop.app.data.remote.ApiEnvelope
import com.sunshop.app.data.remote.CartDto
import com.sunshop.app.data.remote.CartTotalsDto
import com.sunshop.app.data.remote.MoneyDto
import com.sunshop.app.data.remote.SunshopApi
import com.sunshop.app.domain.Result
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/**
 * The repository is the single source of truth for the basket: the bottom-bar
 * badge and the cart screen both read `cart`, so a mutation that forgets to
 * publish the server's reply leaves the two disagreeing about what the user
 * has bought.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CartRepositoryTest {

    private lateinit var api: SunshopApi
    private lateinit var repository: CartRepository

    private fun money(amount: Long) = MoneyDto(amount = amount, currency = "USD")

    private fun cart(id: String = "cart-1", itemCount: Int = 1) = CartDto(
        id = id,
        currency = "USD",
        totals = CartTotalsDto(
            subtotal = money(1000),
            discount = money(0),
            shipping = money(0),
            tax = money(0),
            total = money(1000),
            itemCount = itemCount,
        ),
    )

    private fun envelope(value: CartDto) = ApiEnvelope(ok = true, data = value)

    private fun httpException(status: Int, body: String) = HttpException(
        Response.error<Unit>(status, body.toResponseBody("application/json".toMediaType())),
    )

    @Before
    fun setUp() {
        api = mockk()
        repository = CartRepository(api)
    }

    @Test
    fun `starts empty before anything is fetched`() = runTest {
        assertNull(repository.cart.value)
        assertEquals(0, repository.itemCount())
    }

    @Test
    fun `refresh publishes the server cart`() = runTest {
        val server = cart(itemCount = 3)
        coEvery { api.getCart() } returns envelope(server)

        val result = repository.refresh()

        assertEquals(Result.Success(server), result)
        assertSame(server, repository.cart.value)
        assertEquals(3, repository.itemCount())
    }

    @Test
    fun `add publishes the returned cart rather than mutating locally`() = runTest {
        coEvery { api.addToCart(any()) } returns envelope(cart(itemCount = 2))

        repository.add(productId = "p1", variantId = "v1", quantity = 2)

        assertEquals(2, repository.itemCount())
    }

    @Test
    fun `updateQuantity publishes the recomputed cart`() = runTest {
        coEvery { api.getCart() } returns envelope(cart(itemCount = 5))
        repository.refresh()
        coEvery { api.updateCartItem(any(), any()) } returns envelope(cart(itemCount = 1))

        repository.updateQuantity("item-1", 1)

        assertEquals(1, repository.itemCount())
    }

    @Test
    fun `remove publishes the emptied cart`() = runTest {
        coEvery { api.getCart() } returns envelope(cart(itemCount = 4))
        repository.refresh()
        coEvery { api.removeCartItem(any()) } returns envelope(cart(itemCount = 0))

        repository.remove("item-1")

        assertEquals(0, repository.itemCount())
    }

    @Test
    fun `a rejected mutation leaves the published cart untouched`() = runTest {
        // The badge must keep showing what the server last confirmed, not an
        // optimistic guess the server refused.
        coEvery { api.getCart() } returns envelope(cart(itemCount = 3))
        repository.refresh()
        val before = repository.cart.value

        coEvery { api.addToCart(any()) } throws
            httpException(409, """{"ok":false,"error":{"code":"OUT_OF_STOCK","message":"Sold out."}}""")

        val result = repository.add("p1", "v1", 1)

        assertEquals("OUT_OF_STOCK", (result as Result.Failure).code)
        assertSame(before, repository.cart.value)
        assertEquals(3, repository.itemCount())
    }

    @Test
    fun `a transport failure maps to NetworkError and keeps the cart`() = runTest {
        coEvery { api.getCart() } returns envelope(cart(itemCount = 2))
        repository.refresh()

        coEvery { api.removeCartItem(any()) } throws IOException("offline")

        val result = repository.remove("item-1")

        assertSame(Result.NetworkError, result)
        assertEquals(2, repository.itemCount())
    }

    @Test
    fun `itemCount reports zero when the cart has never loaded`() = runTest {
        coEvery { api.getCart() } throws IOException("offline")

        repository.refresh()

        assertNull(repository.cart.value)
        assertEquals(0, repository.itemCount())
    }
}
