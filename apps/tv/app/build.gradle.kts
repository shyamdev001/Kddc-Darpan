import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Optional server address baked into the APK (GitHub Actions variable DARPAN_SERVER_URL).
// When empty, the TV asks for it on first start.
val defaultServerUrl = (System.getenv("DARPAN_SERVER_URL") ?: "").trim().replace("\"", "")

// GitHub Actions run number, so every build installs over the previous one.
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

// A stable signing key (from GitHub secrets) lets a new APK update the installed app.
val keystorePath: String? = System.getenv("DARPAN_KEYSTORE_PATH")

android {
    namespace = "in.kdcc.darpan"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.kdcc.darpan"
        minSdk = 23 // TVs' Android version not confirmed yet; keep this low
        targetSdk = 34
        versionCode = buildNumber
        versionName = "0.1.$buildNumber"
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$defaultServerUrl\"")
    }

    signingConfigs {
        create("darpan") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("DARPAN_KEYSTORE_PASSWORD")
                keyAlias = "darpan"
                keyPassword = System.getenv("DARPAN_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            if (keystorePath != null) signingConfig = signingConfigs.getByName("darpan")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1") // live streams (.m3u8) for broadcasts
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    // Android already ships org.json; the library's own copy would clash.
    implementation("io.socket:socket.io-client:2.1.1") {
        exclude(group = "org.json", module = "json")
    }
}
