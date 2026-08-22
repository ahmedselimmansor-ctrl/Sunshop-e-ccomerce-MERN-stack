package com.sunshop.app.ui.screens.product

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunshop.app.data.remote.ProductDto
import com.sunshop.app.data.remote.VariantDto
import com.sunshop.app.data.repository.CartRepository
import com.sunshop.app.data.repository.CatalogRepository
import com.sunshop.app.domain.Result
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProductState(
    val loading: Boolean = true,
    val product: ProductDto? = null,
    val selectedOptions: Map<String, String> = emptyMap(),
    val adding: Boolean = false,
    val message: String? = null,
) {
    /**
     * Derived, never stored separately: keeping both a selection map and a
     * variant id in state is how the two drift apart when one axis changes.
     */
    val selectedVariant: VariantDto?
        get() {
            val current = product ?: return null
            if (current.options.isEmpty()) return current.variants.firstOrNull()
            return current.variants.firstOrNull { variant ->
                current.options.all { option ->
                    variant.optionValues[option.code] == selectedOptions[option.code]
                }
            }
        }
}

@HiltViewModel
class ProductViewModel @Inject constructor(
    private val catalog: CatalogRepository,
    private val cart: CartRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(ProductState())
    val state: StateFlow<ProductState> = _state.asStateFlow()

    fun load(slug: String) {
        if (_state.value.product?.slug == slug) return
        _state.value = ProductState(loading = true)

        viewModelScope.launch {
            when (val result = catalog.product(slug)) {
                is Result.Success -> {
                    val product = result.value
                    // Open on a variant that can actually be bought.
                    val default = product.variants.firstOrNull { it.inStock } ?: product.variants.firstOrNull()
                    _state.value = ProductState(
                        loading = false,
                        product = product,
                        selectedOptions = default?.optionValues.orEmpty(),
                    )
                }
                is Result.Failure -> _state.value = ProductState(loading = false, message = result.message)
                Result.NetworkError -> _state.value = ProductState(loading = false, message = "network")
            }
        }
    }

    fun selectOption(code: String, value: String) {
        _state.value = _state.value.copy(
            selectedOptions = _state.value.selectedOptions + (code to value),
        )
    }

    fun addToCart(onAdded: () -> Unit) {
        val current = _state.value
        val variant = current.selectedVariant ?: return
        val product = current.product ?: return

        _state.value = current.copy(adding = true)

        viewModelScope.launch {
            when (val result = cart.add(product.id, variant.id, 1)) {
                is Result.Success -> {
                    _state.value = _state.value.copy(adding = false)
                    onAdded()
                }
                is Result.Failure -> _state.value =
                    _state.value.copy(adding = false, message = result.message)
                Result.NetworkError -> _state.value =
                    _state.value.copy(adding = false, message = "network")
            }
        }
    }

    fun consumeMessage() {
        _state.value = _state.value.copy(message = null)
    }
}
