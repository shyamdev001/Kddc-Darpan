package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Turned off by the TV, not by Darpan" (DC9): only in display hours, never for Darpan's own doing. */
class OffWatchTest {
    private var now = 1_000_000L
    private val watch = OffWatch { now }

    @Test
    fun onlyDisplayHours_count_andNotWhatDarpanDoes() {
        assertTrue(OffWatch.countsAsTv(inHours = true, darpanExpected = false, maintenance = false))
        assertFalse("off hours: Darpan let it sleep", OffWatch.countsAsTv(false, false, false))
        assertFalse("not known yet", OffWatch.countsAsTv(null, false, false))
        assertFalse("restart or screen-off test", OffWatch.countsAsTv(true, true, false))
        assertFalse("someone is using the TV's settings", OffWatch.countsAsTv(true, false, true))
    }

    @Test
    fun anEventIsReportedWithHowLongAgo_andWhenItCameBack() {
        watch.inHours = true
        assertNull(watch.report())
        assertTrue(watch.away(OffWatch.Kind.SCREEN, maintenance = false))
        now += 90_000
        assertFalse("still away: one event, not two", watch.away(OffWatch.Kind.INPUT, maintenance = false))
        assertEquals(OffWatch.Report("screen", 90, null, 1), watch.report())
        now += 30_000
        assertTrue(watch.back())
        assertFalse(watch.back())
        now += 10_000
        assertEquals(OffWatch.Report("screen", 130, 10, 1), watch.report())
    }

    @Test
    fun darpansOwnRestart_isNotCounted_butLaterOnesAre() {
        watch.inHours = true
        watch.expect(60_000)
        assertFalse(watch.away(OffWatch.Kind.INPUT, maintenance = false))
        now += 61_000
        assertTrue(watch.away(OffWatch.Kind.INPUT, maintenance = false))
        assertEquals("input", watch.report()!!.kind)
    }

    @Test
    fun theCountCoversTheLastDay() {
        watch.inHours = true
        repeat(3) {
            watch.away(OffWatch.Kind.SCREEN, maintenance = false)
            now += 60_000
            watch.back()
            now += 8 * 60 * 60 * 1000L
        }
        assertEquals("the first was more than a day ago", 2, watch.report()!!.count)
    }
}
