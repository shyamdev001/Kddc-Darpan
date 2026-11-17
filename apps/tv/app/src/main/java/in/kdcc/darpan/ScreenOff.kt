package `in`.kdcc.darpan

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.util.Log
import kotlinx.coroutines.delay

/** What the screen-off test found. */
data class ScreenOffResult(val wentOff: Boolean, val cameBack: Boolean) {
    /** Safe to switch the panel off at night only when it also comes back by itself. */
    val works: Boolean get() = wentOff && cameBack

    /** For the dashboard's command list; null when it worked. Pure. */
    val problem: String?
        get() = when {
            works -> null
            !wentOff -> "This TV ignores the app's screen-off request. Use the TV's own on/off timer."
            else -> "The screen went off but did not come back by itself. Do not use screen-off on this model; use the TV's own timer."
        }
}

/**
 * Android TV gives apps no standard way to cut the backlight. A device owner may call lockNow(),
 * which switches the display off on many models; whether it does, and whether the app can then
 * wake it again, differs per TV. So head office tests it per model ("Test screen off"), and only
 * then is it worth using at night. The result is kept as a capability.
 */
object ScreenOff {
    private const val TAG = "ScreenOff"

    suspend fun test(activity: Activity): ScreenOffResult? {
        if (!Kiosk.isOwner(activity)) return null
        val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
        val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        // Keep the CPU running while the panel is off, so the wake-up below happens on time.
        val cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "darpan:screen-off-test")
        cpu.acquire(60_000)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) activity.setTurnScreenOn(true)
            dpm.lockNow()
            delay(3_000)
            val wentOff = !pm.isInteractive
            delay(7_000)
            wake(pm)
            delay(3_000)
            return ScreenOffResult(wentOff, pm.isInteractive)
        } catch (e: Exception) {
            Log.w(TAG, "Screen-off test failed", e)
            wake(pm)
            return ScreenOffResult(wentOff = false, cameBack = pm.isInteractive)
        } finally {
            if (cpu.isHeld) cpu.release()
        }
    }

    @Suppress("DEPRECATION") // the only way for an app to switch the panel back on
    private fun wake(pm: PowerManager) {
        try {
            pm.newWakeLock(PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "darpan:wake")
                .acquire(5_000)
        } catch (e: Exception) {
            Log.w(TAG, "Could not wake the screen", e)
        }
    }
}
