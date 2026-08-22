package com.sunshop.app.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunshop.app.data.remote.ProductCardDto
import com.sunshop.app.data.repository.CatalogRepository
import com.sunshop.app.domain.Result
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeState(
    val loading: Boolean = true,
    val featured: List<ProductCardDto> = emptyList(),
    val newest: List<ProductCardDto> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val catalog: CatalogRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)

        viewModelScope.launch {
            // The two rails are independent; fetching them in parallel halves
            // the time to first paint on a slow connection.
            val featured = async { catalog.featured() }
            val newest = async { catalog.newest() }

            val featuredResult = featured.await()
            val newestResult = newest.await()

            val error = listOf(featuredResult, newestResult).firstNotNullOfOrNull { result ->
                when (result) {
                    is Result.Failure -> result.message
                    Result.NetworkError -> "network"
                    else -> null
                }
            }

            _state.value = HomeState(
                loading = false,
                featured = (featuredResult as? Result.Success)?.value.orEmpty(),
                newest = (newestResult as? Result.Success)?.value.orEmpty(),
                // Only surface an error if *both* rails failed; one working rail
                // is still a usable home screen.
                error = if (featuredResult is Result.Success || newestResult is Result.Success) null else error,
            )
        }
    }
}
