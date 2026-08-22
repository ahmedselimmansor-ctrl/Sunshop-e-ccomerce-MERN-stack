package com.sunshop.app.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.sunshop.app.R
import com.sunshop.app.ui.screens.account.AccountScreen
import com.sunshop.app.ui.screens.cart.CartScreen
import com.sunshop.app.ui.screens.home.HomeScreen
import com.sunshop.app.ui.screens.product.ProductScreen
import com.sunshop.app.ui.screens.search.SearchScreen

private data class TabDestination(
    val route: String,
    val labelRes: Int,
    val icon: ImageVector,
)

private val tabs = listOf(
    TabDestination("home", R.string.nav_home, Icons.Outlined.Home),
    TabDestination("search", R.string.nav_search, Icons.Outlined.Search),
    TabDestination("cart", R.string.nav_cart, Icons.Outlined.ShoppingCart),
    TabDestination("account", R.string.nav_account, Icons.Outlined.Person),
)

/**
 * Root navigation.
 *
 * The bottom bar hides on detail screens so a product page gets the full
 * viewport. Tab re-selection pops to the tab's start destination rather than
 * pushing a duplicate: the behaviour every user expects and most apps miss.
 */
@Composable
fun SunshopApp() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    val showBottomBar = tabs.any { it.route == currentRoute }

    Scaffold(
        bottomBar = {
            if (!showBottomBar) return@Scaffold

            NavigationBar {
                tabs.forEach { tab ->
                    val selected = backStackEntry?.destination?.hierarchy?.any { it.route == tab.route } == true

                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = {
                            if (tab.route == "cart") {
                                CartTabIcon(tab.icon)
                            } else {
                                Icon(tab.icon, contentDescription = null)
                            }
                        },
                        label = { Text(stringResource(tab.labelRes)) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "home",
            modifier = Modifier.padding(padding),
        ) {
            composable("home") {
                HomeScreen(onProductClick = { slug -> navController.navigate("product/$slug") })
            }
            composable("search") {
                SearchScreen(onProductClick = { slug -> navController.navigate("product/$slug") })
            }
            composable("cart") {
                CartScreen(onContinueShopping = { navController.navigate("home") })
            }
            composable("account") { AccountScreen() }

            composable("product/{slug}") { entry ->
                ProductScreen(
                    slug = entry.arguments?.getString("slug").orEmpty(),
                    onBack = { navController.popBackStack() },
                    onViewCart = { navController.navigate("cart") },
                )
            }
        }
    }
}

@Composable
private fun CartTabIcon(icon: ImageVector) {
    val viewModel: com.sunshop.app.ui.screens.cart.CartViewModel =
        androidx.hilt.navigation.compose.hiltViewModel()
    val count by viewModel.itemCount.collectAsStateWithLifecycle()

    BadgedBox(
        badge = {
            if (count > 0) Badge { Text(count.toString()) }
        },
    ) {
        Icon(icon, contentDescription = null)
    }
}
