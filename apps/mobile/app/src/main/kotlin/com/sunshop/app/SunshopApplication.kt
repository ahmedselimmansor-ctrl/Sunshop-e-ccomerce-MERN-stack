package com.sunshop.app

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Application entry point.
 *
 * `@HiltAndroidApp` generates the dependency graph; everything else. Retrofit,
 * Room, the token store: is provided by the modules in `di/`, so no singleton
 * is ever constructed by hand at a call site.
 */
@HiltAndroidApp
class SunshopApplication : Application()
