package `in`.kdcc.darpan

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log

/**
 * Screen and power control (docs/DEVICE_COMPATIBILITY.md, section 8).
 *
 * Outside display hours a TV goes dark one of two ways:
 * - **Black** (every TV, the default): the app shows black at the lowest backlight it can ask for
 *   and keeps the panel awake. The TV never sleeps, so it is always back at the on time.
 * - **Panel off** (only device-owner TVs that passed "Test screen off"): lockNow() switches the
 *   panel off and an exact alarm at the on time switches it back on. On many TVs standby stops the
 *   CPU and no alarm can fire, so it is used only after the test showed this model wakes by itself.
 * Real power-on from deep standby is not possible from an app (see the compatibility doc).
 */
object PowerControl {
    private const val TAG = "PowerControl"
    private const val PREFS = "darpan-power"
    private const val KEY_TEST_COMMAND = "testCommand"
    private const val KEY_TEST_DUE = "testDueElapsed"
    private const val KEY_TEST_WENT_OFF = "testWentOff"
    private const val KEY_TEST_FIRED_AT = "testFiredAt"
    const val TEST_WAKE_MS = 60_000L
    /** Seconds the panel gets to light up after the alarm, before the result is read. */
    const val SETTLE_MS = 3_000L
    /** A test still open this long after its alarm was due: the TV did not wake by itself. */
    const val TEST_GRACE_MS = 5 * 60_000L
    private const val REQ_NIGHT = 41
    private const val REQ_TEST = 42

    // ---------- Pure rules (JVM-tested) ----------

    /** Panel off at night only on a device-owner TV that proved it wakes by itself. */
    fun panelOffAtNight(owner: Boolean, wakesByItself: Boolean?): Boolean = owner && wakesByItself == true

    /**
     * The next minute at which the screen should be on, within 8 days after [nowMs]; null with no
     * display hours (always on) or no on-time in that span.
     */
    fun nextOnAt(hours: DisplayHours?, nowMs: Long): Long? {
        if (hours == null) return null
        val end = nowMs + 8 * 24 * 3_600_000L
        var t = nowMs - nowMs % 60_000L + 60_000L
        while (t < end) {
            if (Schedule.hoursOn(hours, t)) return t
            t += 60_000L
        }
        return null
    }

    /** What a wake test has left in prefs. [firedAt] is the uptime the alarm came, or null. */
    data class TestState(val dueElapsed: Long, val wentOff: Boolean, val firedAt: Long?)

    /**
     * The test's result once known, else null (still waiting). [screenOnNow] is read when asked.
     * - the panel never went off: known at once;
     * - the alarm came and the panel had a few seconds: whether it is lit now;
     * - the uptime is below the start (a reboot: someone switched it off and on), or the alarm is
     *   long overdue (the CPU slept through it): it did not come back by itself.
     */
    fun outcome(s: TestState, elapsedNow: Long, screenOnNow: Boolean): ScreenOffResult? = when {
        !s.wentOff -> ScreenOffResult(wentOff = false, cameBack = true)
        s.firedAt != null && elapsedNow >= s.firedAt + SETTLE_MS -> ScreenOffResult(true, screenOnNow)
        elapsedNow < s.dueElapsed - TEST_WAKE_MS -> ScreenOffResult(true, cameBack = false)
        elapsedNow > s.dueElapsed + TEST_GRACE_MS -> ScreenOffResult(true, cameBack = false)
        else -> null
    }

    // ---------- Android ----------

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun pm(context: Context) = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    private fun dpm(context: Context) = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    fun screenOn(context: Context): Boolean = try {
        pm(context).isInteractive
    } catch (e: Exception) {
        true
    }

    /** Switches the panel on (deprecated flags, but the only way an app can). */
    @Suppress("DEPRECATION")
    fun wake(context: Context) {
        try {
            pm(context).newWakeLock(
                PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "darpan:wake",
            ).acquire(10_000)
        } catch (e: Exception) {
            Log.w(TAG, "Could not wake the screen", e)
        }
    }

    /** Panel off (device owner only). False when this TV does not allow it. */
    fun panelOff(context: Context): Boolean = try {
        if (!Kiosk.isOwner(context)) {
            false
        } else {
            dpm(context).lockNow()
            true
        }
    } catch (e: Exception) {
        Log.w(TAG, "lockNow refused", e)
        false
    }

    /** Whether a remote reboot can work here: device owner on Android 7+, and not refused before. */
    fun canReboot(context: Context): Boolean =
        Kiosk.isOwner(context) && Build.VERSION.SDK_INT >= 24 && Capabilities.learned(context, Capabilities.KEY_REBOOT) != false

    /** Device-owner reboot. Returns only when the TV refused (and remembers that). */
    fun reboot(context: Context): Boolean {
        if (!Kiosk.isOwner(context) || Build.VERSION.SDK_INT < 24) return false
        return try {
            dpm(context).reboot(Kiosk.admin(context))
            true
        } catch (e: Exception) {
            Log.w(TAG, "Reboot refused", e)
            Capabilities.learn(context, Capabilities.KEY_REBOOT, false)
            false
        }
    }

    /** Sets (or with null clears) the alarm that wakes the panel at the wall time [atWallMs]. */
    fun scheduleNightWake(context: Context, atWallMs: Long?) {
        val pending = alarmIntent(context, REQ_NIGHT, null)
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarms.cancel(pending)
        if (atWallMs == null) return
        // On the uptime clock: the TV's wall clock may jump; the trusted clock gave the wait.
        val wait = (atWallMs - TrustedClock.now()).coerceAtLeast(0L)
        exactAt(alarms, SystemClock.elapsedRealtime() + wait, pending)
    }

    /**
     * The real "Test screen off": panel off, the CPU let go, and an exact alarm a minute later that
     * must switch it back on by itself. The result comes from [takeResult]. False when this TV
     * cannot try (not device owner).
     */
    suspend fun startTest(context: Context, commandId: String): Boolean {
        if (!Kiosk.isOwner(context)) return false
        val pm = pm(context)
        val due = SystemClock.elapsedRealtime() + TEST_WAKE_MS
        prefs(context).edit().clear().putString(KEY_TEST_COMMAND, commandId).putLong(KEY_TEST_DUE, due).commit()
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        exactAt(alarms, due, alarmIntent(context, REQ_TEST, commandId))
        // Hold the CPU only long enough to see whether the panel went off, then let it sleep.
        val cpu = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "darpan:screen-off-test")
        cpu.acquire(10_000)
        try {
            val off = panelOff(context)
            if (off) kotlinx.coroutines.delay(SETTLE_MS)
            val wentOff = off && !pm.isInteractive
            prefs(context).edit().putBoolean(KEY_TEST_WENT_OFF, wentOff).commit()
            if (!wentOff) alarms.cancel(alarmIntent(context, REQ_TEST, commandId))
        } finally {
            if (cpu.isHeld) cpu.release()
        }
        return true
    }

    /** From the alarm ([WakeReceiver]): note that it came; the panel is switched on separately. */
    fun alarmFired(context: Context, commandId: String) {
        val p = prefs(context)
        if (p.getString(KEY_TEST_COMMAND, null) == commandId) p.edit().putLong(KEY_TEST_FIRED_AT, SystemClock.elapsedRealtime()).commit()
    }

    /** True while a wake test is open (the night rules leave the panel alone meanwhile). */
    fun testOpen(context: Context): Boolean = prefs(context).contains(KEY_TEST_COMMAND)

    /** A finished (or given-up) test, once: the command to answer and the result, which is learned. */
    fun takeResult(context: Context): Pair<String, ScreenOffResult>? {
        val p = prefs(context)
        val id = p.getString(KEY_TEST_COMMAND, null) ?: return null
        if (!p.contains(KEY_TEST_WENT_OFF) && SystemClock.elapsedRealtime() < p.getLong(KEY_TEST_DUE, 0)) return null // still starting
        val fired = if (p.contains(KEY_TEST_FIRED_AT)) p.getLong(KEY_TEST_FIRED_AT, 0) else null
        val state = TestState(p.getLong(KEY_TEST_DUE, 0), p.getBoolean(KEY_TEST_WENT_OFF, true), fired)
        val result = outcome(state, SystemClock.elapsedRealtime(), screenOn(context)) ?: return null
        p.edit().clear().commit()
        Capabilities.learn(context, Capabilities.KEY_SCREEN_OFF, result.works)
        return id to result
    }

    private fun alarmIntent(context: Context, request: Int, commandId: String?): PendingIntent {
        val intent = Intent(context, WakeReceiver::class.java)
        if (commandId != null) intent.putExtra(WakeReceiver.EXTRA_TEST, commandId)
        return PendingIntent.getBroadcast(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Exact when Android lets us (Android 12+ may withhold it); otherwise as near as it allows. */
    private fun exactAt(alarms: AlarmManager, elapsedAt: Long, pending: PendingIntent) {
        try {
            when {
                Build.VERSION.SDK_INT >= 31 && !alarms.canScheduleExactAlarms() ->
                    alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedAt, pending)
                else -> alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedAt, pending)
            }
        } catch (e: SecurityException) {
            alarms.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsedAt, pending)
        }
    }
}
