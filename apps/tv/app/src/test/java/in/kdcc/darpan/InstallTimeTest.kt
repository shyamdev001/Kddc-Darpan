package `in`.kdcc.darpan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InstallTimeTest {
    // 2026-11-23 is a Monday. Times are India time (UTC+5:30).
    private val mondayNoon = java.time.Instant.parse("2026-11-23T06:30:00Z").toEpochMilli()
    private val mondayNight = java.time.Instant.parse("2026-11-23T15:30:00Z").toEpochMilli() // 21:00
    private val tuesday2am = java.time.Instant.parse("2026-11-23T20:30:00Z").toEpochMilli()
    private val hours = DisplayHours(on = "10:00", off = "18:00")

    @Test
    fun duringDisplayHours_waits() {
        assertFalse(InstallTime.quiet(hours, mondayNoon, clockCertain = true, broadcastLive = false))
        assertFalse(InstallTime.mayInstall(installNow = false, urgent = false, quiet = false, waitedMs = 3_600_000L))
    }

    @Test
    fun afterHours_withNoBroadcast_installs() {
        assertTrue(InstallTime.quiet(hours, mondayNight, clockCertain = true, broadcastLive = false))
    }

    @Test
    fun aBroadcast_isNeverInterrupted() {
        assertFalse(InstallTime.quiet(hours, mondayNight, clockCertain = true, broadcastLive = true))
    }

    @Test
    fun alwaysOnTvs_installAtNight() {
        assertFalse(InstallTime.quiet(null, mondayNoon, clockCertain = true, broadcastLive = false))
        assertTrue(InstallTime.quiet(null, tuesday2am, clockCertain = true, broadcastLive = false))
    }

    @Test
    fun noTrustedClock_isNotQuiet() {
        assertFalse(InstallTime.quiet(hours, mondayNight, clockCertain = false, broadcastLive = false))
    }

    @Test
    fun installNow_rescue_orADaysWait_installAtOnce() {
        assertTrue(InstallTime.mayInstall(installNow = true, urgent = false, quiet = false, waitedMs = 0))
        assertTrue(InstallTime.mayInstall(installNow = false, urgent = true, quiet = false, waitedMs = 0))
        assertTrue(InstallTime.mayInstall(installNow = false, urgent = false, quiet = false, waitedMs = InstallTime.MAX_WAIT_MS))
        assertFalse(InstallTime.mayInstall(installNow = false, urgent = false, quiet = false, waitedMs = InstallTime.MAX_WAIT_MS - 1))
    }
}
