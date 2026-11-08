package `in`.kdcc.darpan

import android.content.Context
import android.util.Log

/**
 * The time used for ad dates, schedules and display hours.
 *
 * Many TVs have no clock battery: after a power cut with no network they wake up at a factory
 * date, and every dated ad looks "not started yet". This clock never goes behind the last time
 * we trusted (the server's time from a manifest, or our own clock while it was running), so after
 * such a reboot it carries on from just before the power cut until the network sets the real time.
 */
object TrustedClock {
    private const val TAG = "TrustedClock"
    private const val PREFS = "darpan-clock"
    private const val KEY_FLOOR = "floorMs"
    private const val SAVE_EVERY_MS = 60_000L

    private lateinit var appContext: Context
    private var floorMs = 0L
    private var offsetMs = 0L
    private var savedAt = 0L

    fun init(context: Context) {
        appContext = context.applicationContext
        floorMs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_FLOOR, 0L)
    }

    /** Device time, moved forward when the device clock is behind what we know to be true. */
    @Synchronized
    fun now(): Long {
        val device = System.currentTimeMillis()
        if (device >= floorMs) {
            if (offsetMs != 0L) Log.i(TAG, "Device clock is back on time")
            offsetMs = 0L // the device clock is believable again (network time arrived)
        } else if (device + offsetMs < floorMs) {
            offsetMs = floorMs - device
            Log.w(TAG, "Device clock is behind by ${offsetMs / 1000}s; using the last trusted time")
        }
        val t = device + offsetMs
        remember(t)
        return t
    }

    /** Server time from a fresh manifest: the most trustworthy time we get. */
    @Synchronized
    fun serverTime(ms: Long) {
        val device = System.currentTimeMillis()
        // Only ever correct forwards: a slow or stale server reply must not pull the clock back.
        if (ms > device + offsetMs) offsetMs = ms - device
        remember(ms)
    }

    private fun remember(t: Long) {
        if (t <= floorMs) return
        floorMs = t
        if (t - savedAt >= SAVE_EVERY_MS) {
            savedAt = t
            appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY_FLOOR, t).apply()
        }
    }
}
