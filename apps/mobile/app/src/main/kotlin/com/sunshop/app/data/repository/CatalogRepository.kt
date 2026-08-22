package com.sunshop.app.data.repository

import com.sunshop.app.data.remote.ProductCardDto
import com.sunshop.app.data.remote.ProductDto
import com.sunshop.app.data.remote.SunshopApi
import com.sunshop.app.domain.Result
import com.sunshop.app.domain.runCatchingApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CatalogRepository @Inject constructor(
    private val api: SunshopApi,
) {
    suspend fun featured(): Result<List<ProductCardDto>> = runCatchingApi {
        api.getProducts(limit = 10, featured = true, sort = "best_selling").data
    }

    suspend fun newest(): Result<List<ProductCardDto>> = runCatchingApi {
        api.getProducts(limit = 10, sort = "newest").data
    }

    suspend fun list(page: Int, category: String? = null): Result<List<ProductCardDto>> =
        runCatchingApi { api.getProducts(page = page, category = category).data }

    suspend fun search(query: String, page: Int = 1): Result<List<ProductCardDto>> =
        runCatchingApi { api.search(query = query, page = page).data }

    suspend fun product(idOrSlug: String): Result<ProductDto> = runCatchingApi {
        api.getProduct(idOrSlug).data
    }
}
