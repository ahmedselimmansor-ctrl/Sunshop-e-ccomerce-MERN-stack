package com.sunshop.app.ui.screens.cart

import app.cash.turbine.test
import com.sunshop.app.data.remote.CartDto
import com.sunshop.app.data.remote.CartTotalsDto
import com.sunshop.app.data.remote.MoneyDto
import com.sunshop.app.data.repository.CartRepository
import com.sunshop.app.domain.Result
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * The cart view model owns the bottom-bar badge and the busy/error surface that
 * every cart mutation drives, so the mapping from repository result to UI state
 * is worth pinning.
 *
 * `viewModelScope` dispatches on Main, which does not exist in a JVM unit test;
 * `Dispatchers.setMain` with a `StandardTestDispatcher` is what makes the
 * coroutines here deterministic instead of racy.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CartViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private lateinit var repository: CartRepository
    private lateinit var cartFlow: MutableStateFlow<CartDto?>

    private fun money(amount: Long) = MoneyDto(amount = amount, currency = "USD")

    private fun cart(itemCount: Int) = CartDto(
        id = "cart-1",
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

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        cartFlow = MutableStateFlow(null)
        repository = mockk(relaxed = true)
        every { repository.cart } returns cartFlow
        coEvery { repository.refresh() } returns Result.Success(cart(0))
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `refreshes the cart on construction`() = runTest(dispatcher) {
        CartViewModel(repository)
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.refresh() }
    }

    @Test
    fun `badge count tracks the repository cart`() = runTest(dispatcher) {
        val viewModel = CartViewModel(repository)

        viewModel.itemCount.test {
            assertEquals(0, awaitItem())

            cartFlow.value = cart(itemCount = 3)
            assertEquals(3, awaitItem())

            cartFlow.value = cart(itemCount = 1)
            assertEquals(1, awaitItem())

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `badge shows zero for an empty cart`() = runTest(dispatcher) {
        val viewModel = CartViewModel(repository)
        cartFlow.value = null
        advanceUntilIdle()

        assertEquals(0, viewModel.itemCount.value)
    }

    @Test
    fun `surfaces the server message when a mutation is rejected`() = runTest(dispatcher) {
        coEvery { repository.updateQuantity(any(), any()) } returns
            Result.Failure(code = "OUT_OF_STOCK", message = "Only 2 left.", status = 409)

        val viewModel = CartViewModel(repository)
        advanceUntilIdle()

        viewModel.setQuantity("item-1", 5)
        advanceUntilIdle()

        assertEquals("Only 2 left.", viewModel.message.value)
    }

    @Test
    fun `reports a network failure distinctly from an API rejection`() = runTest(dispatcher) {
        coEvery { repository.remove(any()) } returns Result.NetworkError

        val viewModel = CartViewModel(repository)
        advanceUntilIdle()

        viewModel.remove("item-1")
        advanceUntilIdle()

        assertEquals("network", viewModel.message.value)
    }

    @Test
    fun `clears the message after a successful mutation`() = runTest(dispatcher) {
        coEvery { repository.remove(any()) } returns Result.NetworkError
        coEvery { repository.updateQuantity(any(), any()) } returns Result.Success(cart(1))

        val viewModel = CartViewModel(repository)
        advanceUntilIdle()

        viewModel.remove("item-1")
        advanceUntilIdle()
        assertEquals("network", viewModel.message.value)

        viewModel.setQuantity("item-1", 2)
        advanceUntilIdle()
        assertNull(viewModel.message.value)
    }

    @Test
    fun `consumeMessage clears the surface so a snackbar does not repeat`() = runTest(dispatcher) {
        coEvery { repository.remove(any()) } returns Result.NetworkError

        val viewModel = CartViewModel(repository)
        advanceUntilIdle()
        viewModel.remove("item-1")
        advanceUntilIdle()

        viewModel.consumeMessage()

        assertNull(viewModel.message.value)
    }

    @Test
    fun `busy is false once a mutation settles`() = runTest(dispatcher) {
        coEvery { repository.updateQuantity(any(), any()) } returns Result.Success(cart(1))

        val viewModel = CartViewModel(repository)
        advanceUntilIdle()

        viewModel.setQuantity("item-1", 2)
        advanceUntilIdle()

        assertEquals(false, viewModel.busy.value)
    }
}
