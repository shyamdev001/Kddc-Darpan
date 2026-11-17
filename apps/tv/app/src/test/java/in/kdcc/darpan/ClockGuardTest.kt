package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Never trust the TV's own date: power cuts, factory dates and small network corrections. */
class ClockGuardTest {
    private val nov17 = 1_794_900_000_000L // 2026-11-17, a believable time
    private val min = 60_000L

    @Test
    fun aTvWithItsClockRight_isCertain() {
        val g = ClockGuard(floorMs = nov17 - 10 * min)
        assertEquals(nov17, g.now(nov17))
        assertTrue(g.certain)
    }

    @Test
    fun afterAPowerCut_theTvCarriesOnFromTheLastTrustedTime_butIsNotSure() {
        // Saved at 02:00 before the power went; the TV wakes up believing it is 1970.
        val g = ClockGuard(floorMs = nov17)
        val t = g.now(device = 5_000L)
        assertEquals(nov17, t)
        assertFalse("hours and slots must not be trusted now", g.certain)
        // Time moves on from there, still unsure.
        assertEquals(nov17 + 60_000, g.now(65_000L))
        assertFalse(g.certain)
    }

    @Test
    fun theServerAnswering_makesItCertain_andTheTimeRight() {
        val g = ClockGuard(floorMs = nov17)
        g.now(5_000L)
        val real = nov17 + 8 * 60 * min // power came back 8 hours later
        g.server(real, device = 6_000L)
        assertTrue(g.certain)
        assertEquals(real + 1_000, g.now(7_000L))
        assertTrue("stays certain on the corrected time", g.certain)
    }

    @Test
    fun networkTimeSettingTheTvClock_makesItCertain() {
        val g = ClockGuard(floorMs = nov17)
        g.now(5_000L)
        assertFalse(g.certain)
        assertEquals(nov17 + 3 * 60 * min, g.now(nov17 + 3 * 60 * min))
        assertTrue(g.certain)
    }

    @Test
    fun aNewTvAtItsFactoryDate_isNotSure_evenWithNothingSaved() {
        val g = ClockGuard(floorMs = 0)
        g.now(1_420_070_400_000L) // 1 Jan 2015
        assertFalse(g.certain)
    }

    @Test
    fun aSmallCorrectionBack_keepsAGoodClockGood_andNeverGoesBack() {
        val g = ClockGuard(floorMs = 0)
        assertEquals(nov17, g.now(nov17))
        assertTrue(g.certain)
        // Network time pulls the clock back 3 s: time does not run backwards, and it is still sure.
        assertEquals(nov17 + 1_000, g.now(nov17 + 1_000))
        assertEquals(nov17 + 1_000, g.now(nov17 - 2_000))
        assertTrue(g.certain)
        // A jump back of an hour is a lost clock.
        g.now(nov17 - 60 * min)
        assertFalse(g.certain)
    }

    @Test
    fun aStaleServerAnswer_neverPullsTheClockBack() {
        val g = ClockGuard(floorMs = 0)
        g.now(nov17)
        g.server(nov17 - 10_000, device = nov17)
        assertEquals(nov17, g.now(nov17))
    }

    @Test
    fun aPlayRecordedWhileUnsure_getsItsRealTime_inTheSameBootOnly() {
        // Shown 100 s after boot; the time became known at 400 s after boot (real time T).
        val t = nov17
        assertEquals(t - 300_000, PlayLogStore.restamp(elapsedAt = 100_000, lineBoot = "boot-7", boot = "boot-7", nowMs = t, nowElapsed = 400_000))
        assertNull("another boot: elapsed time means nothing", PlayLogStore.restamp(100_000, "boot-6", "boot-7", t, 400_000))
        assertNull(PlayLogStore.restamp(-1, "boot-7", "boot-7", t, 400_000))
        assertNull(PlayLogStore.restamp(500_000, "boot-7", "boot-7", t, 400_000))
    }
}
