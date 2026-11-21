package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The pure rules behind TV control (docs/DEVICE_COMPATIBILITY.md). */
class TvControlTest {
    // 2026-11-23 is a Monday. Times are India time (UTC+5:30).
    private fun ist(s: String) = java.time.Instant.parse(s).toEpochMilli()
    private val hours = DisplayHours(on = "10:00", off = "18:00")

    @Test
    fun panelOff_onlyOnOwnerTvsThatPassedTheTest() {
        assertTrue(PowerControl.panelOffAtNight(owner = true, wakesByItself = true))
        assertFalse(PowerControl.panelOffAtNight(owner = true, wakesByItself = null)) // never tested: stay lit
        assertFalse(PowerControl.panelOffAtNight(owner = true, wakesByItself = false))
        assertFalse(PowerControl.panelOffAtNight(owner = false, wakesByItself = true))
    }

    @Test
    fun nextOnAt_isTheNextMorning() {
        val night = ist("2026-11-23T15:30:00Z") // Monday 21:00
        assertEquals(ist("2026-11-24T04:30:00Z"), PowerControl.nextOnAt(hours, night)) // Tuesday 10:00
        val early = ist("2026-11-24T02:00:30Z") // Tuesday 07:30:30
        assertEquals(ist("2026-11-24T04:30:00Z"), PowerControl.nextOnAt(hours, early))
    }

    @Test
    fun nextOnAt_skipsDaysWithoutHours() {
        val weekdays = DisplayHours(days = listOf(1, 2, 3, 4, 5), on = "10:00", off = "18:00") // Sunday = 0
        val friday = ist("2026-11-27T15:30:00Z") // Friday 21:00
        assertEquals(ist("2026-11-30T04:30:00Z"), PowerControl.nextOnAt(weekdays, friday)) // Monday 10:00
    }

    @Test
    fun nextOnAt_noHoursMeansNoAlarm() {
        assertNull(PowerControl.nextOnAt(null, ist("2026-11-23T15:30:00Z")))
    }

    private val due = 1_000_000L
    private fun state(wentOff: Boolean = true, firedAt: Long? = null) = PowerControl.TestState(due, wentOff, firedAt)

    @Test
    fun test_panelThatNeverWentOff_isKnownAtOnce() {
        val r = PowerControl.outcome(state(wentOff = false), due - 50_000, screenOnNow = true)!!
        assertFalse(r.works)
        assertTrue(r.problem!!.contains("ignores"))
    }

    @Test
    fun test_alarmCameAndPanelLit_works() {
        assertNull(PowerControl.outcome(state(firedAt = due), due + 1_000, screenOnNow = true)) // settling
        assertTrue(PowerControl.outcome(state(firedAt = due), due + PowerControl.SETTLE_MS, screenOnNow = true)!!.works)
    }

    @Test
    fun test_alarmCameButPanelStayedDark_fails() {
        val r = PowerControl.outcome(state(firedAt = due), due + PowerControl.SETTLE_MS, screenOnNow = false)!!
        assertFalse(r.works)
        assertTrue(r.wentOff)
    }

    @Test
    fun test_noAlarm_waitsThenFails() {
        assertNull(PowerControl.outcome(state(), due + 60_000, screenOnNow = false))
        assertFalse(PowerControl.outcome(state(), due + PowerControl.TEST_GRACE_MS + 1, screenOnNow = true)!!.cameBack)
    }

    @Test
    fun test_aRebootSinceTheStart_fails() {
        // Uptime below the start: someone switched the TV off and on; it did not wake by itself.
        assertFalse(PowerControl.outcome(state(), 30_000, screenOnNow = true)!!.cameBack)
    }

    @Test
    fun volume_percentToSteps() {
        assertEquals(0, AudioControl.toStep(0, 15))
        assertEquals(8, AudioControl.toStep(50, 15))
        assertEquals(15, AudioControl.toStep(100, 15))
        assertEquals(15, AudioControl.toStep(130, 15))
        assertEquals(0, AudioControl.toStep(-5, 15))
        assertEquals(0, AudioControl.toStep(50, 0))
        assertEquals(53, AudioControl.toPercent(8, 15))
        assertEquals(100, AudioControl.toPercent(15, 15))
        assertEquals(0, AudioControl.toPercent(3, 0))
    }

    @Test
    fun statusWords() {
        assertEquals("severe", TvStatus.thermalWord(3))
        assertNull(TvStatus.thermalWord(99))
        assertEquals("lowMemory", TvStatus.exitWord(3))
        assertEquals("unknown", TvStatus.exitWord(0))
    }
}
