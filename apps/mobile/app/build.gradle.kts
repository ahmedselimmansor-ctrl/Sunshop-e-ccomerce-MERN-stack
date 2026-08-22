import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

/**
 * API endpoints come from `local.properties` (developer machines) or from CI
 * environment variables: never hardcoded, so a debug build cannot accidentally
 * ship pointing at production.
 */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun endpoint(key: String, fallback: String): String =
    (localProperties.getProperty(key) ?: System.getenv(key) ?: fallback)

fun secret(key: String): String? =
    (localProperties.getProperty(key) ?: System.getenv(key))?.takeIf { it.isNotBlank() }

/**
 * Release signing credentials, from `local.properties` or CI environment, or
 * null when the machine has no keystore.
 *
 * All four must be present or none are used: a half-configured keystore fails
 * deep inside the signing task with a message that says nothing useful. Absent
 * credentials leave the release build unsigned rather than failing it, so
 * anyone can verify that R8 and the shrinker still work without holding the
 * production key.
 */
val releaseKeystore: Map<String, String>? = listOf(
    "SUNSHOP_KEYSTORE_FILE",
    "SUNSHOP_KEYSTORE_PASSWORD",
    "SUNSHOP_KEY_ALIAS",
    "SUNSHOP_KEY_PASSWORD",
).associateWith { secret(it) }
    .takeIf { creds -> creds.values.all { it != null } }
    ?.mapValues { (_, value) -> value!! }

android {
    namespace = "com.sunshop.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sunshop.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Arabic and English ship in the APK; anything else is stripped.
        resourceConfigurations += setOf("en", "ar")
        vectorDrawables.useSupportLibrary = true
    }

    signingConfigs {
        releaseKeystore?.let { creds ->
            create("release") {
                storeFile = file(creds.getValue("SUNSHOP_KEYSTORE_FILE"))
                storePassword = creds.getValue("SUNSHOP_KEYSTORE_PASSWORD")
                keyAlias = creds.getValue("SUNSHOP_KEY_ALIAS")
                keyPassword = creds.getValue("SUNSHOP_KEY_PASSWORD")
                // v1 is only needed below API 24; minSdk is 26.
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // 10.0.2.2 is the host machine as seen from the Android emulator.
            buildConfigField("String", "API_BASE_URL", "\"${endpoint("API_BASE_URL_DEBUG", "http://10.0.2.2:4000/api/v1/")}\"")
            buildConfigField("String", "CDN_BASE_URL", "\"${endpoint("CDN_BASE_URL_DEBUG", "http://10.0.2.2:9000/sunshop-media-dev/")}\"")
            isDebuggable = true
        }
        release {
            buildConfigField("String", "API_BASE_URL", "\"${endpoint("API_BASE_URL", "https://api.sunshop.example/api/v1/")}\"")
            buildConfigField("String", "CDN_BASE_URL", "\"${endpoint("CDN_BASE_URL", "https://cdn.sunshop.example/")}\"")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Null when no keystore is configured, which leaves the APK unsigned.
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Lets minSdk 26 use java.time and other newer APIs.
        isCoreLibraryDesugaringEnabled = false
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf("-opt-in=kotlin.RequiresOptIn")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    ksp(libs.hilt.compiler)

    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    implementation(libs.datastore.preferences)
    implementation(libs.security.crypto)
    implementation(libs.coil.compose)
    implementation(libs.paging.compose)

    testImplementation(libs.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(platform(libs.compose.bom))
}
