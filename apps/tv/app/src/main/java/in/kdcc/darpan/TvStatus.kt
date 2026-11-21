package `in`.kdcc.darpan

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONObject
import java.net.Inet4Address

/**
 * The TV's own state for the screen page (docs/DEVICE_COMPATIBILITY.md, section 8). Every field may be
 * null: what a model does not report stays empty instead of being guessed.
 */
object TvStatus {
    /** Android's thermal status (API 29+) as a word. Pure. */
    fun thermalWord(status: Int): String? = when (status) {
        0 -> "none"
        1 -> "light"
        2 -> "moderate"
        3 -> "severe"
        4 -> "critical"
        5 -> "emergency"
        6 -> "shutdown"
        else -> null
    }

    /** ApplicationExitInfo reason (API 30+) as a word. Pure. */
    fun exitWord(reason: Int): String = when (reason) {
        1 -> "exitSelf"
        2 -> "signaled"
        3 -> "lowMemory"
        4 -> "crash"
        5 -> "nativeCrash"
        6 -> "anr"
        7 -> "initFailure"
        8 -> "permissionChange"
        9 -> "excessiveResource"
        10 -> "userRequested"
        11 -> "userStopped"
        12 -> "dependencyDied"
        13 -> "other"
        14 -> "frozen"
        else -> "unknown"
    }

    fun report(context: Context, nightMode: String?): JSONObject {
        val audio = AudioControl.state(context)
        return JSONObject()
            .put("screenOn", PowerControl.screenOn(context))
            .put("uptimeSec", SystemClock.elapsedRealtime() / 1000)
            .put("ip", ipv4(context) ?: JSONObject.NULL)
            .put("networkType", networkType(context) ?: JSONObject.NULL)
            .put("thermal", thermal(context) ?: JSONObject.NULL)
            .put("bootReason", bootReason() ?: JSONObject.NULL)
            .put("lastExit", lastExit(context) ?: JSONObject.NULL)
            .put("volume", audio?.percent ?: JSONObject.NULL)
            .put("muted", audio?.muted ?: JSONObject.NULL)
            .put("nightMode", nightMode ?: JSONObject.NULL)
    }

    private fun cm(context: Context) = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private fun ipv4(context: Context): String? = try {
        val cm = cm(context)
        cm.getLinkProperties(cm.activeNetwork)?.linkAddresses
            ?.map { it.address }?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
    } catch (e: Exception) {
        null
    }

    private fun networkType(context: Context): String? = try {
        val cm = cm(context)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }
    } catch (e: Exception) {
        null
    }

    /** Few TVs expose a temperature to apps; the thermal status is the closest standard thing. */
    private fun thermal(context: Context): String? = if (Build.VERSION.SDK_INT >= 29) {
        try {
            thermalWord((context.getSystemService(Context.POWER_SERVICE) as PowerManager).currentThermalStatus)
        } catch (e: Exception) {
            null
        }
    } else {
        null
    }

    /** "sys.boot.reason" (often "reboot", "cold_boot", "watchdog"...); hidden on many builds. */
    private fun bootReason(): String? = try {
        val c = Class.forName("android.os.SystemProperties")
        (c.getMethod("get", String::class.java).invoke(null, "sys.boot.reason") as? String)?.takeIf { it.isNotBlank() }?.take(60)
    } catch (e: Throwable) {
        null
    }

    /** Why the previous run of this app ended (Android 11+). */
    private fun lastExit(context: Context): JSONObject? = if (Build.VERSION.SDK_INT >= 30) {
        try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            am.getHistoricalProcessExitReasons(context.packageName, 0, 1).firstOrNull()?.let { e: ApplicationExitInfo ->
                JSONObject().put("reason", exitWord(e.reason)).put("agoSec", ((System.currentTimeMillis() - e.timestamp) / 1000).coerceAtLeast(0L))
            }
        } catch (e: Exception) {
            null
        }
    } else {
        null
    }
}
