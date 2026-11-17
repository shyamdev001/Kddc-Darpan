package `in`.kdcc.darpan

import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaCodecList
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import android.webkit.WebView
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class WebViewInfo(val `package`: String, val version: String, val major: Int?)

@Serializable
data class NetworkInfo(val type: String, val wifiDbm: Int?)

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
)

/**
 * What this TV model can and cannot do. TVs differ (WebView age, decoders, whether the system
 * brightness is honoured...), so the app checks for itself instead of assuming, and head office
 * sees it on the screen page. The fixed facts are read once per start; what the app learns while
 * running (brightness read-back, screen-off and screenshot results) is kept across restarts.
 */
object Capabilities {
    private const val TAG = "Capabilities"
    private const val PREFS = "darpan-capabilities"

    private data class Fixed(val webView: WebViewInfo?, val h264Fhd: Boolean?, val hevc: Boolean?)

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
            h264Fhd = f.h264Fhd,
            hevc = f.hevc,
            deviceOwner = Kiosk.isOwner(context),
            brightness = learned(KEY_BRIGHTNESS),
            network = network(context),
            screenOff = learned(KEY_SCREEN_OFF),
            videoInScreenshot = learned(KEY_VIDEO_SCREENSHOT),
        )
    }

    /** Record something the app found out while running. */
    fun learn(context: Context, key: String, value: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(key, value).apply()
    }

    const val KEY_BRIGHTNESS = "brightness"
    const val KEY_SCREEN_OFF = "screenOff"
    const val KEY_VIDEO_SCREENSHOT = "videoInScreenshot"

    private fun detectFixed(context: Context): Fixed = Fixed(webView(context), decoder("video/avc", 1920, 1080), decoder("video/hevc", 1280, 720))

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

    /** A decoder (not encoder) for this type that handles this size. null when the list cannot be read. */
    private fun decoder(mime: String, width: Int, height: Int): Boolean? = try {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
            !info.isEncoder && info.supportedTypes.any { it.equals(mime, ignoreCase = true) } &&
                info.getCapabilitiesForType(mime).videoCapabilities?.isSizeSupported(width, height) == true
        }
    } catch (e: Exception) {
        Log.w(TAG, "Decoder check failed for $mime", e)
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
