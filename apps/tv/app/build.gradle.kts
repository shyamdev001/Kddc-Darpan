import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Optional server address baked into the APK (GitHub Actions variable DARPAN_SERVER_URL).
// When empty, the TV asks for it on first start.
val defaultServerUrl = (System.getenv("DARPAN_SERVER_URL") ?: "").trim().replace("\"", "")

// GitHub Actions run number plus a fixed offset (apps/tv/version.properties), so every build
// installs over the previous one even after the run number starts again at 1 (docs/AUDIT.md K4).
val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
val versionOffset = java.util.Properties().run {
    rootProject.file("version.properties").inputStream().use { load(it) }
    getProperty("offset").trim().toInt()
}
val buildNumber = versionOffset + runNumber

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
        // Head-office testing only: debuggable, and plain HTTP to a laptop on the LAN is allowed.
        debug {
            if (keystorePath != null) signingConfig = signingConfigs.getByName("darpan")
        }
        // What branch TVs run: not debuggable (adb cannot read the TV's key), HTTPS only.
        // Same key as the debug build, so either installs over the other.
        // Code shrinking (R8) stays off until a shrunk build has been tested on a real TV:
        // a missing keep rule would only show up as a crash at a branch.
        release {
            isDebuggable = false
            isMinifyEnabled = false
            if (keystorePath != null) signingConfig = signingConfigs.getByName("darpan")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        // Plain JVM tests (no device): Android calls such as Log return defaults instead of failing.
        unitTests.isReturnDefaultValues = true
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

    // Tests only (run on the build machine; not part of the APK).
    testImplementation("junit:junit:4.13.2")
}
