package `in`.kdcc.darpan

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Time slots and display hours, always in India time whatever the TV's own clock zone is.
 * Same rules as packages/shared/src/schedule.ts: keep the two in step.
 *
 * A daily window [start, end) belongs to the day it starts on; start == end means the whole day;
 * an end earlier than the start runs past midnight.
 */
object Schedule {
    private val IST: TimeZone = TimeZone.getTimeZone("Asia/Kolkata")
    private const val DAY_MIN = 24 * 60

    private class LocalDay(val date: String, val dow: Int, val dayOfMonth: Int)

    private fun calendar(nowMs: Long): Calendar = Calendar.getInstance(IST, Locale.US).apply { timeInMillis = nowMs }

    private fun localDay(nowMs: Long, shiftDays: Int = 0): LocalDay {
        val c = calendar(nowMs)
        if (shiftDays != 0) c.add(Calendar.DAY_OF_MONTH, shiftDays)
        val date = String.format(
            Locale.US, "%04d-%02d-%02d",
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
        )
        return LocalDay(date, c.get(Calendar.DAY_OF_WEEK) - 1, c.get(Calendar.DAY_OF_MONTH)) // Sunday = 0
    }

    private fun localMinutes(nowMs: Long): Int {
        val c = calendar(nowMs)
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
    }

    /** "09:30" -> 570; null if malformed. */
    fun toMinutes(hhmm: String?): Int? {
        if (hhmm == null) return null
        val parts = hhmm.split(":")
        if (parts.size != 2) return null
        val h = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        return if (h in 0..23 && m in 0..59) h * 60 + m else null
    }

    private fun windowActive(nowMs: Long, start: Int, end: Int, dayOk: (LocalDay) -> Boolean): Boolean {
        val now = localMinutes(nowMs)
        return when {
            start == end -> dayOk(localDay(nowMs))
            start < end -> now >= start && now < end && dayOk(localDay(nowMs))
            now >= start -> dayOk(localDay(nowMs))
            now < end -> dayOk(localDay(nowMs, -1))
            else -> false
        }
    }

    fun slotActive(slot: TimeSlot, nowMs: Long): Boolean {
        val start = if (slot.start == null) 0 else toMinutes(slot.start) ?: return false
        val end = if (slot.end == null) DAY_MIN else toMinutes(slot.end) ?: return false
        return windowActive(nowMs, start, end) { d ->
            (slot.days.isEmpty() || d.dow in slot.days) &&
                (slot.fromDate == null || d.date >= slot.fromDate) &&
                (slot.toDate == null || d.date <= slot.toDate)
        }
    }

    /** No slots means "always". */
    fun slotsActive(slots: List<TimeSlot>, nowMs: Long): Boolean = slots.isEmpty() || slots.any { slotActive(it, nowMs) }

    /** No hours (or unreadable hours) means "always on": a dark branch TV is worse than one left on. */
    fun hoursOn(hours: DisplayHours?, nowMs: Long): Boolean {
        if (hours == null) return true
        val on = toMinutes(hours.on) ?: return true
        val off = toMinutes(hours.off) ?: return true
        return windowActive(nowMs, on, off) { d ->
            (hours.days.isEmpty() || d.dow in hours.days) &&
                !(d.dow == 6 && ((d.dayOfMonth + 6) / 7) in hours.closedSaturdays)
        }
    }
}
