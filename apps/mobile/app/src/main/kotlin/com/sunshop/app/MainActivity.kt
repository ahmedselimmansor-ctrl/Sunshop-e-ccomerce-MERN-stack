package com.sunshop.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sunshop.app.ui.SunshopApp
import com.sunshop.app.ui.theme.SunshopTheme
import com.sunshop.app.ui.theme.ThemePreference
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Draw behind the system bars; the theme handles the icon contrast.
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        setContent {
            val viewModel: MainViewModel = androidx.lifecycle.viewmodel.compose.viewModel()
            val theme by viewModel.theme.collectAsStateWithLifecycle(ThemePreference.SYSTEM)

            SunshopTheme(preference = theme) {
                SunshopApp()
            }
        }
    }
}
