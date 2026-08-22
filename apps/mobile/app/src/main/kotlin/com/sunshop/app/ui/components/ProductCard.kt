package com.sunshop.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sunshop.app.data.remote.ProductCardDto
import com.sunshop.app.domain.formatRange
import java.util.Locale

/**
 * Catalogue tile.
 *
 * The whole card carries one merged semantics node with the product name and
 * price, so TalkBack announces "Linen Summer Dress, 899 pounds" instead of
 * reading the image, the brand and the price as three separate stops.
 */
@Composable
fun ProductCard(
    product: ProductCardDto,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val language = Locale.getDefault().language
    val name = product.name.resolve(language)
    val price = product.priceRange.min.formatRange(product.priceRange.max)

    Card(
        modifier = modifier
            .clickable(onClick = onClick)
            .semantics(mergeDescendants = true) { contentDescription = "$name, $price" },
    ) {
        Column {
            AsyncImage(
                model = product.image?.url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
            )

            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                product.brand?.let {
                    Text(
                        text = it.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Text(
                    text = name,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )

                Text(
                    text = price,
                    style = MaterialTheme.typography.titleMedium,
                )

                if (!product.inStock) {
                    Text(
                        text = androidx.compose.ui.res.stringResource(com.sunshop.app.R.string.label_out_of_stock),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}
