package com.sunshop.app.ui.screens.cart

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunshop.app.data.remote.CartDto
import com.sunshop.app.data.repository.CartRepository
import com.sunshop.app.domain.Result
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CartViewModel @Inject constructor(
    private val repository: CartRepository,
) : ViewModel() {

    val cart: StateFlow<CartDto?> = repository.cart

    /** Drives the bottom-bar badge. */
    val itemCount: StateFlow<Int> = repository.cart
        .map { it?.totals?.itemCount ?: 0 }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        refresh()
    }

    fun refresh() = viewModelScope.launch {
        _busy.value = true
        repository.refresh().also { report(it) }
        _busy.value = false
    }

    fun setQuantity(itemId: String, quantity: Int) = viewModelScope.launch {
        _busy.value = true
        repository.updateQuantity(itemId, quantity).also { report(it) }
        _busy.value = false
    }

    fun remove(itemId: String) = viewModelScope.launch {
        _busy.value = true
        repository.remove(itemId).also { report(it) }
        _busy.value = false
    }

    fun consumeMessage() {
        _message.value = null
    }

    private fun report(result: Result<*>) {
        _message.value = when (result) {
            is Result.Failure -> result.message
            Result.NetworkError -> "network"
            is Result.Success -> null
        }
    }
}
