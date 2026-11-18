package `in`.kdcc.darpan

import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaCodecList
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import android.webkit.WebView
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

@Serializable
data class WebViewInfo(val `package`: String, val version: String, val major: Int?)

@Serializable
data class NetworkInfo(val type: String, val wifiDbm: Int?)

/** Who made the TV and what it runs (DC4). Sent every heartbeat, so a firmware update shows. */
@Serializable
data class DeviceFacts(val brand: String, val manufacturer: String, val model: String, val chipset: String?, val os: String)

/** The picture Android draws, and the panel behind it (a 4K panel often runs Android at 1080p). */
@Serializable
data class DisplayFacts(val width: Int, val height: Int, val dpi: Int?, val panelWidth: Int?, val panelHeight: Int?, val refreshHz: Int?)

/** The best profile and level a format's decoders offer, and whether the server's files play. */
@Serializable
data class CodecSupport(val profile: String, val level: String, val ours: Boolean, val portrait: Boolean)

@Serializable
data class DecoderFacts(val name: String, val type: String, val hardware: Boolean)

@Serializable
data class VideoFacts(val avc: CodecSupport?, val hevc: CodecSupport?, val decoders: List<DecoderFacts>)

/** Sent in the heartbeat as "capabilities"; the field names match the server's TvCapabilities. */
@Serializable
data class CapabilityReport(
    val sdk: Int,
    val webView: WebViewInfo?,
    @SerialName("h264_1080p") val h264Fhd: Boolean?,
    val hevc: Boolean?,
    val deviceOwner: Boolean,
    val brightness: Boolean?,
    val network: NetworkInfo,
    val screenOff: Boolean?,
    val videoInScreenshot: Boolean?,
    val device: DeviceFacts?,
    val display: DisplayFacts?,
    val video: VideoFacts?,
    /** "googletv", "androidtv" or "aosp" (Android without Google's TV services). */
    val platform: String?,
)

/**
 * What this TV model can and cannot do. TVs differ (WebView age, decoders, whether the system
 * brightness is honoured...), so the app checks for itself instead of assuming, and head office
 * sees it on the screen page. The fixed facts are read once per start; what the app learns while
 * running (brightness read-back, screen-off and screenshot results) is kept across restarts.
 */
object Capabilities {
    private const val TAG = "Capabilities"
    private const val MAX_DECODERS = 40
    private const val PREFS = "darpan-capabilities"

    private data class Fixed(val webView: WebViewInfo?, val video: VideoFacts?, val device: DeviceFacts, val display: DisplayFacts?, val platform: String?)

    @Volatile
    private var fixed: Fixed? = null

    /** "91.0.4472.114" → 91. Pure. */
    fun webViewMajor(version: String?): Int? = version?.trim()?.substringBefore('.')?.toIntOrNull()?.takeIf { it in 1..999 }

    fun report(context: Context): CapabilityReport {
        val f = fixed ?: detectFixed(context).also { fixed = it }
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        fun learned(key: String): Boolean? = if (p.contains(key)) p.getBoolean(key, false) else null
        return CapabilityReport(
            sdk = Build.VERSION.SDK_INT,
            webView = f.webView,
            // "Plays our files": High profile at level 4.0, 1080p at 30 fps (DC5), not just the size.
            h264Fhd = f.video?.let { it.avc?.ours ?: false },
            hevc = f.video?.let { it.hevc?.ours ?: false },
            deviceOwner = Kiosk.isOwner(context),
            brightness = learned(KEY_BRIGHTNESS),
            network = network(context),
            screenOff = learned(KEY_SCREEN_OFF),
            videoInScreenshot = learned(KEY_VIDEO_SCREENSHOT),
            device = f.device,
            display = f.display,
            video = f.video,
            platform = f.platform,
        )
    }

    /** Record something the app found out while running. */
    fun learn(context: Context, key: String, value: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(key, value).apply()
    }

    const val KEY_BRIGHTNESS = "brightness"
    const val KEY_SCREEN_OFF = "screenOff"
    const val KEY_VIDEO_SCREENSHOT = "videoInScreenshot"

    private fun detectFixed(context: Context): Fixed =
        Fixed(webView(context), video(), device(), display(context), platform(context))

    private fun device(): DeviceFacts {
        val soc = if (Build.VERSION.SDK_INT >= 31) {
            listOf(Build.SOC_MANUFACTURER, Build.SOC_MODEL).filter { it.isNotBlank() && it != Build.UNKNOWN }.joinToString(" ").ifBlank { null }
        } else {
            null
        }
        return DeviceFacts(
            brand = Build.BRAND.take(40),
            manufacturer = Build.MANUFACTURER.take(40),
            model = Build.MODEL.take(80),
            chipset = (soc ?: Build.HARDWARE.takeIf { it.isNotBlank() && it != Build.UNKNOWN })?.take(80),
            os = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})".take(60),
        )
    }

    @Suppress("DEPRECATION")
    private fun display(context: Context): DisplayFacts? = try {
        val d = (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        val real = DisplayMetrics().also { d.getRealMetrics(it) }
        val mode = d.mode
        DisplayFacts(real.widthPixels, real.heightPixels, real.densityDpi, mode.physicalWidth, mode.physicalHeight, mode.refreshRate.roundToInt())
    } catch (e: Exception) {
        Log.w(TAG, "Display check failed", e)
        null
    }

    private fun platform(context: Context): String? = try {
        val pm = context.packageManager
        fun installed(name: String) = try {
            pm.getPackageInfo(name, 0)
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }
        CodecRules.platform(
            leanback = pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK),
            googleTvLauncher = installed("com.google.android.apps.tv.launcherx"),
            playServices = installed("com.google.android.gms"),
        )
    } catch (e: Exception) {
        null
    }

    /** Every video decoder, and the best H.264 / H.265 they offer. null when the list cannot be read. */
    private fun video(): VideoFacts? = try {
        val decoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        fun offers(mime: String): List<CodecRules.Offer> = decoders.filter { info -> info.supportedTypes.any { it.equals(mime, ignoreCase = true) } }.mapNotNull { info ->
            try {
                val caps = info.getCapabilitiesForType(mime)
                val v = caps.videoCapabilities
                CodecRules.Offer(
                    levels = caps.profileLevels.map { CodecRules.ProfileLevel(it.profile, it.level) },
                    landscape1080p30 = v?.areSizeAndRateSupported(1920, 1080, 30.0) == true,
                    portrait1080p30 = v?.areSizeAndRateSupported(1080, 1920, 30.0) == true,
                )
            } catch (e: Exception) {
                null
            }
        }
        val list = decoders.flatMap { info ->
            info.supportedTypes.filter { it.startsWith("video/", ignoreCase = true) }.map { type ->
                val reported = if (Build.VERSION.SDK_INT >= 29) info.isHardwareAccelerated else null
                DecoderFacts(info.name.take(80), type.removePrefix("video/").take(30), CodecRules.isHardware(info.name, reported))
            }
        }
        VideoFacts(CodecRules.avc(offers("video/avc")), CodecRules.hevc(offers("video/hevc")), list.take(MAX_DECODERS))
    } catch (e: Exception) {
        Log.w(TAG, "Decoder check failed", e)
        null
    }

    /** The installed system WebView, without creating one (that would cost memory). */
    private fun webView(context: Context): WebViewInfo? = try {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WebView.getCurrentWebViewPackage()
        } else {
            listOf("com.google.android.webview", "com.android.webview", "com.android.chrome").firstNotNullOfOrNull { name ->
                try {
                    context.packageManager.getPackageInfo(name, 0)
                } catch (e: PackageManager.NameNotFoundException) {
                    null
                }
            }
        }
        info?.let { WebViewInfo(it.packageName, it.versionName ?: "unknown", webViewMajor(it.versionName)) }
    } catch (e: Exception) {
        Log.w(TAG, "WebView check failed", e)
        null
    }

    private fun network(context: Context): NetworkInfo = try {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        when {
            caps == null -> NetworkInfo("none", null)
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkInfo("ethernet", null)
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkInfo("wifi", wifiDbm(context, caps))
            else -> NetworkInfo("other", null)
        }
    } catch (e: Exception) {
        NetworkInfo("other", null)
    }

    @Suppress("DEPRECATION")
    private fun wifiDbm(context: Context, caps: NetworkCapabilities): Int? {
        val fromCaps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) caps.signalStrength else Int.MIN_VALUE
        val dbm = if (fromCaps != Int.MIN_VALUE) {
            fromCaps
        } else {
            try {
                (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo.rssi
            } catch (e: Exception) {
                return null
            }
        }
        return dbm.takeIf { it in -127..0 }
    }
}
