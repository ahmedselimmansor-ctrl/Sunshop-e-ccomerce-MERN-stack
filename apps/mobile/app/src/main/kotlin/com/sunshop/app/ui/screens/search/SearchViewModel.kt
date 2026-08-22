package com.sunshop.app.ui.screens.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunshop.app.data.remote.ProductCardDto
import com.sunshop.app.data.repository.CatalogRepository
import com.sunshop.app.domain.Result
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SearchState(
    val query: String = "",
    val results: List<ProductCardDto> = emptyList(),
    val loading: Boolean = false,
)

@OptIn(FlowPreview::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val catalog: CatalogRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(SearchState())
    val state: StateFlow<SearchState> = _state.asStateFlow()

    private val queryFlow = MutableStateFlow("")

    init {
        viewModelScope.launch {
            queryFlow
                // Search is the most expensive endpoint in the API; a request
                // per keystroke would be the single largest source of load.
                .debounce(300)
                .distinctUntilChanged()
                .filter { it.trim().length >= 2 }
                .collect { term ->
                    _state.value = _state.value.copy(loading = true)
                    val result = catalog.search(term)
                    _state.value = _state.value.copy(
                        loading = false,
                        results = (result as? Result.Success)?.value.orEmpty(),
                    )
                }
        }
    }

    fun onQueryChange(value: String) {
        _state.value = _state.value.copy(query = value)
        queryFlow.value = value
    }
}
