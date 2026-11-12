package `in`.kdcc.darpan

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.WindowManager

/**
 * Screen brightness from the dashboard (display hours), in percent; null leaves the TV alone.
 *
 * Two ways, both tried:
 * - Device owner on Android 9+: the system brightness setting. Before the first change the TV's own
 *   value is saved, and put back when the dashboard turns brightness off again.
 * - Always: this app's window brightness, which some TVs honour even when the system setting is
 *   ignored (many TVs control the backlight from their own picture settings, so check on the TV).
 */
object Brightness {
    private const val TAG = "Brightness"
    private const val PREFS = "darpan-brightness"
    private const val KEY_ORIGINAL = "original"
    private const val KEY_ORIGINAL_MODE = "originalMode"
    private const val MIN = 10

    fun apply(activity: Activity, percent: Int?) {
        val p = percent?.coerceIn(MIN, 100)
        try {
            val lp = activity.window.attributes
            lp.screenBrightness = if (p == null) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else p / 100f
            activity.window.attributes = lp
        } catch (e: Exception) {
            Log.w(TAG, "Window brightness not set", e)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && Kiosk.isOwner(activity)) setSystem(activity, p)
    }

    private fun setSystem(context: Context, p: Int?) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = Kiosk.admin(context)
        val resolver = context.contentResolver
        try {
            if (p != null) {
                if (!prefs.contains(KEY_ORIGINAL)) {
                    val current = Settings.System.getInt(resolver, Settings.System.SCREEN_BRIGHTNESS, -1)
                    val mode = Settings.System.getInt(
                        resolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL,
                    )
                    if (current >= 0) prefs.edit().putInt(KEY_ORIGINAL, current).putInt(KEY_ORIGINAL_MODE, mode).apply()
                }
                val level = (p * 255 + 50) / 100
                dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL.toString())
                dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS, level.toString())
            } else if (prefs.contains(KEY_ORIGINAL)) {
                dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS, prefs.getInt(KEY_ORIGINAL, 128).toString())
                dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS_MODE, prefs.getInt(KEY_ORIGINAL_MODE, 0).toString())
                prefs.edit().clear().apply()
            }
        } catch (e: Exception) {
            Log.w(TAG, "System brightness not set", e)
        }
    }
}
