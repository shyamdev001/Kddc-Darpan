package `in`.kdcc.darpan

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings
import java.util.UUID

/** Small settings kept in the app's private storage. */
class Prefs(private val context: Context) {
    private val p = context.getSharedPreferences("darpan", Context.MODE_PRIVATE)

    /** Server base address, e.g. http://10.0.0.5:4000. Falls back to the address baked into the APK. */
    var serverUrl: String
        get() = p.getString(KEY_SERVER, null) ?: BuildConfig.DEFAULT_SERVER_URL
        set(value) {
            p.edit().putString(KEY_SERVER, value).commit()
        }

    val deviceToken: String? get() = p.getString(KEY_TOKEN, null)

    var paired: Boolean
        get() = p.getBoolean(KEY_PAIRED, false)
        set(value) {
            p.edit().putBoolean(KEY_PAIRED, value).commit()
        }

    fun saveDevice(deviceId: String, token: String) {
        // commit (not apply): losing the token would force a new pairing.
        p.edit().putString(KEY_DEVICE, deviceId).putString(KEY_TOKEN, token).putBoolean(KEY_PAIRED, false).commit()
    }

    fun clearDevice() {
        p.edit().remove(KEY_DEVICE).remove(KEY_TOKEN).remove(KEY_PAIRED).remove(KEY_PENDING_DEVICE).remove(KEY_PENDING_TOKEN).commit()
    }

    /** A new key waiting for head office to enter its code, while the old (refused) key is kept. */
    val pendingToken: String? get() = p.getString(KEY_PENDING_TOKEN, null)

    fun savePending(deviceId: String, token: String) {
        p.edit().putString(KEY_PENDING_DEVICE, deviceId).putString(KEY_PENDING_TOKEN, token).commit()
    }

    fun clearPending() {
        p.edit().remove(KEY_PENDING_DEVICE).remove(KEY_PENDING_TOKEN).commit()
    }

    /** Head office entered the new code: the new key becomes this TV's key. */
    fun promotePending() {
        val id = p.getString(KEY_PENDING_DEVICE, null) ?: return
        val token = p.getString(KEY_PENDING_TOKEN, null) ?: return
        p.edit().putString(KEY_DEVICE, id).putString(KEY_TOKEN, token).putBoolean(KEY_PAIRED, true)
            .remove(KEY_PENDING_DEVICE).remove(KEY_PENDING_TOKEN).commit()
    }

    /**
     * Stable id for this TV. ANDROID_ID survives app updates and data clears (it only changes on
     * a factory reset or a different signing key), so a re-installed app is recognised as the same TV.
     */
    @SuppressLint("HardwareIds")
    fun hardwareId(): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        if (!androidId.isNullOrBlank() && androidId != BROKEN_ANDROID_ID) return "android-$androidId"
        val saved = p.getString(KEY_FALLBACK_ID, null)
        if (saved != null) return saved
        val fresh = "uuid-" + UUID.randomUUID().toString()
        p.edit().putString(KEY_FALLBACK_ID, fresh).commit()
        return fresh
    }

    private companion object {
        const val KEY_SERVER = "serverUrl"
        const val KEY_DEVICE = "deviceId"
        const val KEY_TOKEN = "deviceToken"
        const val KEY_PAIRED = "paired"
        const val KEY_PENDING_DEVICE = "pendingDeviceId"
        const val KEY_PENDING_TOKEN = "pendingDeviceToken"
        const val KEY_FALLBACK_ID = "fallbackHardwareId"
        const val BROKEN_ANDROID_ID = "9774d56d682e549c" // shared by many old devices
    }
}
