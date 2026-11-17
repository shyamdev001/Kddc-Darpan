package `in`.kdcc.darpan

import android.content.Context
import android.util.Log

/**
 * The time used for ad dates, schedules and display hours.
 *
 * Many TVs have no clock battery: after a power cut with no network they wake up at a factory
 * date, and every dated ad looks "not started yet". This clock never goes behind the last time
 * we trusted (the server's time, or our own clock while it was right), so after such a reboot it
 * carries on from just before the power cut until the network sets the real time.
 *
 * That carried-on time can be hours wrong, so it is marked [certain] = false until the server
 * answers or the TV's own clock is set again. Playback then ignores display hours and time slots
 * (docs: SYNC_DESIGN.md, section 2): a dark screen at 10 am because the TV believes it is 2 am is
 * worse than a screen left on.
 */
object TrustedClock {
    private const val TAG = "TrustedClock"
    private const val PREFS = "darpan-clock"
    private const val KEY_FLOOR = "floorMs"
    private const val SAVE_EVERY_MS = 60_000L

    private lateinit var appContext: Context
    private var guard = ClockGuard(0L)
    private var savedAt = 0L

    fun init(context: Context) {
        appContext = context.applicationContext
        val floor = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_FLOOR, 0L)
        guard = ClockGuard(floor)
        guard.now(System.currentTimeMillis())
        if (!guard.certain) Log.w(TAG, "TV clock is behind the last trusted time or not set: treating the time as uncertain")
    }

    /** False while the time is only carried on from before a restart (see the class note). */
    val certain: Boolean get() = synchronized(this) { guard.certain }

    /** Device time, moved forward when the device clock is behind what we know to be true. */
    @Synchronized
    fun now(): Long {
        val wasCertain = guard.certain
        val t = guard.now(System.currentTimeMillis())
        if (wasCertain != guard.certain) Log.i(TAG, if (guard.certain) "Device clock is set again" else "Device clock went back; using the last trusted time")
        save(t)
        return t
    }

    /** The server's time: the most trustworthy time we get. */
    @Synchronized
    fun serverTime(ms: Long) {
        guard.server(ms, System.currentTimeMillis())
        save(guard.floor)
    }

    private fun save(t: Long) {
        if (t - savedAt < SAVE_EVERY_MS) return
        savedAt = t
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY_FLOOR, guard.floor).apply()
    }
}

/**
 * The rules of [TrustedClock], free of Android so they can be tested.
 *
 * - The time never goes behind [floor], the latest time known to be true.
 * - The device clock is believed when it is at or past the floor and later than [plausibleMs]
 *   (a TV showing 1970 or its factory date has lost its clock).
 * - Otherwise the time is carried on from the floor and is not [certain], until the server
 *   answers or the device clock is set again.
 */
class ClockGuard(floorMs: Long, private val plausibleMs: Long = PLAUSIBLE_MS) {
    var floor: Long = floorMs
        private set
    var certain: Boolean = false
        private set
    private var offset = 0L
    private var fromServer = false

    fun now(device: Long): Long {
        if (device >= floor && device >= plausibleMs) {
            offset = 0L
            fromServer = false
            certain = true
        } else if (device + offset < floor) {
            // Behind what we know: carry on from there. A small step back (network time correcting
            // a few seconds) keeps a good clock good; a big one means the TV lost its clock.
            offset = floor - device
            certain = certain && offset <= SMALL_STEP_BACK_MS
            if (!certain) fromServer = false
        } else if (!fromServer && device < plausibleMs) {
            certain = false
        }
        val t = device + offset
        if (t > floor) floor = t
        return t
    }

    fun server(ms: Long, device: Long) {
        // Never moves back: a slow or stale answer must not pull the clock behind what we know.
        if (ms > device + offset) offset = ms - device
        fromServer = true
        certain = true
        if (ms > floor) floor = ms
    }

    companion object {
        /** 1 Jan 2026: no TV running this app can truly be earlier. */
        const val PLAUSIBLE_MS = 1_767_225_600_000L

        /** Network time may move a clock back a little; more than this is a lost clock. */
        const val SMALL_STEP_BACK_MS = 5 * 60_000L
    }
}
