package `in`.kdcc.darpan

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log

/**
 * Kiosk mode. Only active when this app is the TV's device owner (set once with adb, see README);
 * on any other TV every call here does nothing and the app behaves as before.
 *
 * Locked: the app is pinned (lock task), it is the only home app, and Home, Recents and the
 * notification shade do nothing. Maintenance: unlocked for a while so a technician can use the
 * TV's settings; it locks itself again when the time is up.
 */
object Kiosk {
    private const val TAG = "Kiosk"
    private const val PREFS = "darpan-kiosk"
    private const val KEY_UNTIL = "maintenanceUntil"
    const val MAINTENANCE_MS = 15 * 60_000L

    fun admin(context: Context) = ComponentName(context, AdminReceiver::class.java)

    private fun dpm(context: Context) = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    fun isOwner(context: Context): Boolean = try {
        dpm(context).isDeviceOwnerApp(context.packageName)
    } catch (e: Exception) {
        false
    }

    /** When maintenance ends (wall clock, ms), or 0 when locked. Survives an app restart. */
    private fun maintenanceUntil(context: Context): Long {
        val until = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_UNTIL, 0)
        // A clock jump must not leave a TV unlocked for days.
        return if (until > System.currentTimeMillis() + MAINTENANCE_MS) 0 else until
    }

    fun inMaintenance(context: Context): Boolean = maintenanceUntil(context) > System.currentTimeMillis()

    /** "off" (not device owner), "maintenance" or "locked"; sent in the heartbeat. */
    fun state(context: Context): String = when {
        !isOwner(context) -> "off"
        inMaintenance(context) -> "maintenance"
        else -> "locked"
    }

    fun maintenanceEndsAt(context: Context): Long? = maintenanceUntil(context).takeIf { it > System.currentTimeMillis() }

    private fun pinned(activity: Activity): Boolean {
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    /**
     * Applies the device-owner policies and pins the app, unless in maintenance. Safe to call
     * often (every onResume and once a minute).
     */
    fun enforce(activity: Activity) {
        if (!isOwner(activity)) return
        try {
            val dpm = dpm(activity)
            val admin = admin(activity)
            dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
            // Darpan is always the home app, so the TV opens it at power-on and Home comes back here.
            val home = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, home, ComponentName(activity, MainActivity::class.java))
            dpm.setKeyguardDisabled(admin, true)
            dpm.setStatusBarDisabled(admin, !inMaintenance(activity))
            if (inMaintenance(activity)) {
                if (pinned(activity)) activity.stopLockTask()
            } else if (!pinned(activity)) {
                activity.startLockTask()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not apply kiosk mode", e)
        }
    }

    /** Unlocks for [MAINTENANCE_MS]. False if this TV is not in kiosk mode. */
    fun startMaintenance(activity: Activity): Boolean {
        if (!isOwner(activity)) return false
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong(KEY_UNTIL, System.currentTimeMillis() + MAINTENANCE_MS).commit()
        enforce(activity)
        return true
    }

    /** Ends maintenance now. False if this TV is not in kiosk mode. */
    fun endMaintenance(activity: Activity): Boolean {
        if (!isOwner(activity)) return false
        activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_UNTIL).commit()
        bringToFront(activity)
        enforce(activity)
        return true
    }

    /** Opens Darpan over whatever is on screen (the TV's settings after maintenance). */
    fun bringToFront(context: Context) {
        try {
            context.startActivity(
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not bring the app to the front", e)
        }
    }
}
