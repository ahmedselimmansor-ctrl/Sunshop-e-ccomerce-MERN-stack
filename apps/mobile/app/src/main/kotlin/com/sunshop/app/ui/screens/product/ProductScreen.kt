package com.sunshop.app.ui.screens.product

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.sunshop.app.R
import com.sunshop.app.domain.format
import java.util.Locale

/**
 * Product detail.
 *
 * The "add to cart" button reflects the *selected variant's* availability, not
 * the product's: a product with stock in size L must still refuse to add an
 * out-of-stock size M.
 */
// FlowRow is what wraps the variant chips onto a second line on narrow screens;
// it is still marked experimental, so the opt-in is required to compile.
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProductScreen(
    slug: String,
    onBack: () -> Unit,
    onViewCart: () -> Unit,
    viewModel: ProductViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val language = Locale.getDefault().language

    LaunchedEffect(slug) { viewModel.load(slug) }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.product?.name?.resolve(language).orEmpty()) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        val product = state.product

        if (state.loading || product == null) {
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            AsyncImage(
                model = product.images.firstOrNull()?.url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f),
            )

            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(product.name.resolve(language), style = MaterialTheme.typography.headlineMedium)

                Text(
                    text = state.selectedVariant?.price?.format()
                        ?: product.priceRange.min.format(),
                    style = MaterialTheme.typography.titleLarge,
                )

                product.options.forEach { option ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(option.name.resolve(language), style = MaterialTheme.typography.labelLarge)

                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            option.values.forEach { value ->
                                FilterChip(
                                    selected = state.selectedOptions[option.code] == value.code,
                                    onClick = { viewModel.selectOption(option.code, value.code) },
                                    label = { Text(value.label.resolve(language)) },
                                )
                            }
                        }
                    }
                }

                Text(product.description.resolve(language), style = MaterialTheme.typography.bodyMedium)

                Button(
                    onClick = { viewModel.addToCart(onAdded = onViewCart) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = state.selectedVariant?.inStock == true && !state.adding,
                ) {
                    Text(
                        if (state.selectedVariant?.inStock == true) {
                            stringResource(R.string.action_add_to_cart)
                        } else {
                            stringResource(R.string.label_out_of_stock)
                        },
                    )
                }
            }
        }
    }
}
