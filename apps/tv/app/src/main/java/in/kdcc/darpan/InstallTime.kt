package `in`.kdcc.darpan

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * When a downloaded app update may install (docs/AUDIT.md K5). Installing closes the app for a few
 * seconds, so it waits for a quiet moment: outside display hours with no broadcast on, or, on a TV
 * that is on all day (no display hours), between 1 and 4 am India time. It does not wait when head
 * office marked the release "install at once", in rescue mode (the fix is the point), or after a day
 * of waiting (a TV switched off every night would otherwise never update).
 */
object InstallTime {
    const val MAX_WAIT_MS = 24 * 3_600_000L
    private val IST: TimeZone = TimeZone.getTimeZone("Asia/Kolkata")

    fun mayInstall(installNow: Boolean, urgent: Boolean, quiet: Boolean, waitedMs: Long): Boolean =
        installNow || urgent || quiet || waitedMs >= MAX_WAIT_MS

    /**
     * True at a quiet moment. [clockCertain] false (no trusted time yet): the TV cannot tell, so not
     * quiet; the day cap still applies.
     */
    fun quiet(hours: DisplayHours?, nowMs: Long, clockCertain: Boolean, broadcastLive: Boolean): Boolean {
        if (broadcastLive || !clockCertain) return false
        if (hours == null) {
            val h = Calendar.getInstance(IST, Locale.US).apply { timeInMillis = nowMs }.get(Calendar.HOUR_OF_DAY)
            return h in 1..3
        }
        return !Schedule.hoursOn(hours, nowMs)
    }
}
