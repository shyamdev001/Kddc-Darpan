package `in`.kdcc.darpan

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.app.admin.SystemUpdatePolicy
import android.os.Build
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings
import android.util.Log

/**
 * Kiosk mode. Only active when this app is the TV's device owner (set once with adb, see
 * docs/KIOSK_RUNBOOK.md); on any other TV every call here does nothing and the app behaves as before.
 *
 * Locked: the app is pinned (lock task), it is the only home app, and Home, Recents and the
 * notification shade do nothing. Maintenance: unlocked for a while so a technician can use the
 * TV's settings; it locks itself again when the time is up. Exited (K7): head office took the TV out
 * of kiosk mode for good; it stays so until a "lock" command. Removed: no longer device owner.
 */
object Kiosk {
    private const val TAG = "Kiosk"
    private const val PREFS = "darpan-kiosk"
    private const val KEY_UNTIL = "maintenanceUntil"
    private const val KEY_EXITED = "exited"
    const val MAINTENANCE_MS = 15 * 60_000L

    /** The policy set last applied in this process, so the 30-second enforce does not repeat it. */
    @Volatile private var applied: Set<String>? = null

    fun admin(context: Context) = ComponentName(context, AdminReceiver::class.java)

    private fun dpm(context: Context) = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isOwner(context: Context): Boolean = try {
        dpm(context).isDeviceOwnerApp(context.packageName)
    } catch (e: Exception) {
        false
    }

    /** When maintenance ends (wall clock, ms), or 0 when locked. Survives an app restart. */
    private fun maintenanceUntil(context: Context): Long {
        val until = prefs(context).getLong(KEY_UNTIL, 0)
        // A clock jump must not leave a TV unlocked for days.
        return if (until > System.currentTimeMillis() + MAINTENANCE_MS) 0 else until
    }

    fun inMaintenance(context: Context): Boolean = maintenanceUntil(context) > System.currentTimeMillis()

    /** Head office took this TV out of kiosk mode (K7). */
    fun exited(context: Context): Boolean = prefs(context).getBoolean(KEY_EXITED, false)

    /** True while the TV is locked to Darpan: device owner, not in maintenance, not taken out. */
    fun holds(context: Context): Boolean = isOwner(context) && !inMaintenance(context) && !exited(context)

    /** "off" (not device owner), "exited", "maintenance" or "locked"; sent in the heartbeat. */
    fun state(context: Context): String = when {
        !isOwner(context) -> "off"
        exited(context) -> "exited"
        inMaintenance(context) -> "maintenance"
        else -> "locked"
    }

    /** True when Android debugging (adb) is switched on; reported to the dashboard. */
    fun adbEnabled(context: Context): Boolean = try {
        Settings.Global.getInt(context.contentResolver, Settings.Global.ADB_ENABLED, 0) == 1
    } catch (e: Exception) {
        false
    }

    fun maintenanceEndsAt(context: Context): Long? = maintenanceUntil(context).takeIf { it > System.currentTimeMillis() }

    private fun pinned(activity: Activity): Boolean {
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    /**
     * Applies the device-owner policies and pins the app, unless in maintenance or taken out of kiosk
     * mode. Safe to call often (every onResume and every 30 s).
     */
    fun enforce(activity: Activity) {
        if (!isOwner(activity)) return
        if (exited(activity)) {
            release(activity)
            return
        }
        try {
            val dpm = dpm(activity)
            val admin = admin(activity)
            val maintenance = inMaintenance(activity)
            dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
            // Darpan is always the home app, so the TV opens it at power-on and Home comes back here.
            val home = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, home, ComponentName(activity, MainActivity::class.java))
            dpm.setKeyguardDisabled(admin, true)
            dpm.setStatusBarDisabled(admin, !maintenance)
            // Restrictions per state, with the reason for each, in KioskPolicy (K6). Debugging stays
            // open in rescue mode (K2) so a crash-looping TV can still be fixed without a factory reset.
            val rescue = DarpanApp.crashes(activity)?.inRescue() == true
            val want = KioskPolicy.restrictions(exited = false, maintenance = maintenance, rescue = rescue, debugBuild = BuildConfig.DEBUG)
            if (want != applied) {
                applyRestrictions(dpm, admin, want)
                deviceSettings(dpm, admin)
                applied = want
            }
            if (maintenance) {
                if (pinned(activity)) activity.stopLockTask()
            } else if (!pinned(activity)) {
                activity.startLockTask()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not apply kiosk mode", e)
        }
    }

    /** Undoes everything [enforce] sets. Each step on its own, so one failure does not stop the rest. */
    private fun release(activity: Activity) {
        val dpm = dpm(activity)
        val admin = admin(activity)
        fun step(name: String, block: () -> Unit) = try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "Could not $name", e)
        }
        step("unpin") { if (pinned(activity)) activity.stopLockTask() }
        step("clear lock task packages") { dpm.setLockTaskPackages(admin, emptyArray()) }
        step("clear the home app") { dpm.clearPackagePersistentPreferredActivities(admin, activity.packageName) }
        step("enable the status bar") { dpm.setStatusBarDisabled(admin, false) }
        step("enable the keyguard") { dpm.setKeyguardDisabled(admin, false) }
        step("clear restrictions") { applyRestrictions(dpm, admin, emptySet()) }
        step("clear the firmware update window") { dpm.setSystemUpdatePolicy(admin, null) }
        applied = null
    }

    /** Sets [want] and clears every other restriction Darpan manages. Each on its own (OEM builds differ). */
    private fun applyRestrictions(dpm: DevicePolicyManager, admin: ComponentName, want: Set<String>) {
        for (key in KioskPolicy.MANAGED) {
            try {
                if (key in want) dpm.addUserRestriction(admin, key) else dpm.clearUserRestriction(admin, key)
            } catch (e: Exception) {
                Log.w(TAG, "Could not set $key", e)
            }
        }
    }

    /**
     * Settings a device owner may make once it holds the TV (K6, K11). Each on its own, guarded by
     * Android version: TV firmware is often missing one or another.
     */
    private fun deviceSettings(dpm: DevicePolicyManager, admin: ComponentName) {
        fun step(name: String, block: () -> Unit) = try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "Could not $name", e)
        }
        // The power menu stays (branch staff switch the TV off), Home and Recents do not; safe boot
        // from that menu is blocked by a restriction above.
        if (Build.VERSION.SDK_INT >= 28) {
            step("set lock task features") { dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS) }
        }
        // Firmware updates at night only, not in the middle of a banking day.
        step("set the firmware update window") {
            dpm.setSystemUpdatePolicy(admin, SystemUpdatePolicy.createWindowedInstallPolicy(KioskPolicy.UPDATE_WINDOW_START_MIN, KioskPolicy.UPDATE_WINDOW_END_MIN))
        }
        // The right time from the network: schedules and proof of play depend on it.
        if (Build.VERSION.SDK_INT >= 30) {
            step("turn on automatic time") { dpm.setAutoTimeEnabled(admin, true) }
        } else {
            @Suppress("DEPRECATION")
            step("turn on automatic time") { dpm.setGlobalSetting(admin, Settings.Global.AUTO_TIME, "1") }
        }
        if (Build.VERSION.SDK_INT >= 28) {
            step("set the sleep timeout") {
                dpm.setSystemSetting(admin, Settings.System.SCREEN_OFF_TIMEOUT, KioskPolicy.SCREEN_OFF_TIMEOUT_MS.toString())
            }
        }
    }

    /** Unlocks for [MAINTENANCE_MS]. False if this TV is not in kiosk mode. */
    fun startMaintenance(activity: Activity): Boolean {
        if (!isOwner(activity)) return false
        prefs(activity).edit().putLong(KEY_UNTIL, System.currentTimeMillis() + MAINTENANCE_MS).commit()
        enforce(activity)
        return true
    }

    /** Ends maintenance now, and undoes "exit kiosk" (K7). False if this TV is not in kiosk mode. */
    fun endMaintenance(activity: Activity): Boolean {
        if (!isOwner(activity)) return false
        prefs(activity).edit().remove(KEY_UNTIL).remove(KEY_EXITED).commit()
        bringToFront(activity)
        enforce(activity)
        return true
    }

    /** Takes the TV out of kiosk mode until a "lock" command (K7). Darpan keeps playing. */
    fun exit(activity: Activity): Boolean {
        if (!isOwner(activity)) return false
        prefs(activity).edit().putBoolean(KEY_EXITED, true).remove(KEY_UNTIL).commit()
        release(activity)
        return true
    }

    /**
     * Exit, then stop being device owner (K7). One-way: making it a kiosk again needs adb
     * (runbook, section 1). Afterwards the app can be uninstalled from the TV's settings.
     */
    fun removeOwner(activity: Activity): Boolean {
        if (!exit(activity)) return false
        return try {
            @Suppress("DEPRECATION")
            dpm(activity).clearDeviceOwnerApp(activity.packageName)
            // A later adb set-device-owner must start locked, not exited.
            prefs(activity).edit().remove(KEY_EXITED).commit()
            !isOwner(activity)
        } catch (e: Exception) {
            Log.w(TAG, "Could not stop being device owner", e)
            false
        }
    }

    /** Opens Darpan over whatever is on screen (the TV's settings after maintenance). */
    fun bringToFront(context: Context, wake: Boolean = false) {
        try {
            context.startActivity(
                Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                    .putExtra(MainActivity.EXTRA_WAKE, wake),
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not bring the app to the front", e)
        }
    }
}
