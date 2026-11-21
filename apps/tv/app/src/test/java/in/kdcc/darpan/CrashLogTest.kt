package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** A crash-looping TV says why, and falls back to posters only instead of blinking on and off. */
class CrashLogTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val t0 = 1_800_000_000_000L
    private fun min(n: Int) = n * 60_000L

    @Test
    fun aCrash_isRemembered_acrossRestarts() {
        val dir = tmp.newFolder()
        val error = RuntimeException("wrapper", OutOfMemoryError("Failed to allocate 8294400 bytes"))
        CrashLog(dir).record(error, t0)

        val after = CrashLog(dir) // the next start reads the file
        val r = after.report(t0 + 1_000)!!
        assertEquals("java.lang.OutOfMemoryError", r.type)
        assertEquals("Failed to allocate 8294400 bytes", r.message)
        assertTrue(r.frames.isNotEmpty())
        assertEquals(1, r.total)
        assertEquals(1, r.recent)
        assertFalse(after.inSafeMode(t0 + 1_000))
    }

    @Test
    fun neverCrashed_reportsNothing() {
        assertNull(CrashLog(tmp.newFolder()).report())
    }

    @Test
    fun fiveCrashesInTenMinutes_startSafeMode_forAnHour() {
        val dir = tmp.newFolder()
        for (i in 0 until 5) CrashLog(dir).record(IllegalStateException("boom $i"), t0 + min(2 * i))
        val log = CrashLog(dir)
        assertTrue(log.inSafeMode(t0 + min(9)))
        assertTrue(log.inSafeMode(t0 + min(8) + min(59)))
        assertFalse(log.inSafeMode(t0 + min(8) + min(61)))
        assertEquals(5, log.report(t0 + min(9))!!.recent)
    }

    @Test
    fun fiveCrashesSpreadOverAnHour_doNot() {
        val dir = tmp.newFolder()
        for (i in 0 until 5) CrashLog(dir).record(IllegalStateException("boom"), t0 + min(15 * i))
        assertFalse(CrashLog(dir).inSafeMode(t0 + min(61)))
        assertFalse(CrashLog.shouldEnterSafeMode(listOf(t0, t0 + min(3), t0 + min(6), t0 + min(9)), t0 + min(9)))
        assertTrue(CrashLog.shouldEnterSafeMode(listOf(t0, t0 + min(3), t0 + min(6), t0 + min(8), t0 + min(9)), t0 + min(9)))
    }

    @Test
    fun aRestartFromHeadOffice_leavesSafeMode() {
        val dir = tmp.newFolder()
        for (i in 0 until 5) CrashLog(dir).record(IllegalStateException("boom"), t0 + i)
        CrashLog(dir).clearSafeMode()
        assertFalse(CrashLog(dir).inSafeMode(t0 + 10))
    }

    @Test
    fun eachCrash_waitsLonger_upToFiveMinutes() {
        val dir = tmp.newFolder()
        val waits = (0 until 7).map { i -> CrashLog(dir).record(IllegalStateException("boom"), t0 + i * 1_000L, elapsedNow = 50_000L + i) }
        assertEquals(listOf(3_000L, 10_000L, 30_000L, 120_000L, 300_000L, 300_000L, 300_000L), waits)
        assertEquals(3_000L, CrashLog.restartDelayMs(listOf(t0 - min(31)), t0)) // old crashes do not count
    }

    @Test
    fun aStartTooSoonAfterACrash_waits() {
        val dir = tmp.newFolder()
        CrashLog(dir).record(IllegalStateException("boom"), t0, elapsedNow = 100_000L)
        val log = CrashLog(dir)
        assertEquals(2_000L, log.coolDownMs(101_000L)) // Android reopened its home app after 1 s
        assertEquals(0L, log.coolDownMs(103_000L))
        assertEquals(0L, log.coolDownMs(10L)) // after a reboot the uptime clock starts again: run now
    }

    @Test
    fun aCrashInSafeMode_startsRescueMode_forThisVersionOnly() {
        val dir = tmp.newFolder()
        for (i in 0 until 5) CrashLog(dir, versionCode = 40).record(IllegalStateException("boom"), t0 + min(i))
        assertTrue(CrashLog(dir, 40).inSafeMode(t0 + min(5)))
        assertFalse(CrashLog(dir, 40).inRescue(t0 + min(5)))

        CrashLog(dir, 40).record(IllegalStateException("again"), t0 + min(6))
        assertTrue(CrashLog(dir, 40).inRescue(t0 + min(7)))
        assertTrue(CrashLog(dir, 40).inSafeMode(t0 + min(7)))
        assertFalse(CrashLog(dir, 41).inRescue(t0 + min(7))) // the fixed version starts normally
        // An hour after the last crash it plays normally again.
        assertTrue(CrashLog(dir, 40).inRescue(t0 + min(6) + min(59)))
        assertFalse(CrashLog(dir, 40).inRescue(t0 + min(6) + min(61)))
    }

    @Test
    fun tenCrashesInHalfAnHour_startRescueMode_evenWithoutSafeMode() {
        assertTrue(CrashLog.shouldEnterRescue(List(10) { t0 + min(3 * it) }, t0 + min(28), wasSafe = false))
        assertFalse(CrashLog.shouldEnterRescue(List(9) { t0 + min(3 * it) }, t0 + min(28), wasSafe = false))
    }

    @Test
    fun rescueMode_endsOnARemoteRestart_andACrashThereKeepsItOn() {
        val dir = tmp.newFolder()
        for (i in 0 until 6) CrashLog(dir, 7).record(IllegalStateException("boom"), t0 + min(i))
        val log = CrashLog(dir, 7)
        assertTrue(log.inRescue(t0 + min(30)))
        log.record(IllegalStateException("in rescue"), t0 + min(50))
        assertTrue(CrashLog(dir, 7).inRescue(t0 + min(50) + min(59))) // a crash in rescue extends it
        CrashLog(dir, 7).clearSafeMode()
        assertFalse(CrashLog(dir, 7).inRescue(t0 + min(51)))
        assertFalse(CrashLog(dir, 7).inSafeMode(t0 + min(51)))
    }

    @Test
    fun aClockSetBack_cannotStretchRescueMode() {
        val dir = tmp.newFolder()
        for (i in 0 until 6) CrashLog(dir, 7).record(IllegalStateException("boom"), t0 + min(i))
        assertFalse(CrashLog(dir, 7).inRescue(t0 - 86_400_000L))
    }

    @Test
    fun rescueMode_showsOnlyTheDefaultSlide() {
        fun item(id: String, type: String) = ManifestItem(mediaId = id, url = "http://tv.test/$id", sha256 = id, size = 1, type = type, durationSec = 10)
        val m = Manifest(
            version = "1",
            items = listOf(item("slide", "IMAGE"), item("poster", "IMAGE"), item("video", "VIDEO")),
            playlists = listOf(ManifestPlaylist(id = "p", items = listOf(PlaylistEntry("poster", 10)))),
            broadcast = ManifestBroadcast(id = "b", kind = "MESSAGE", message = "Closed"),
            fallbackMediaId = "slide",
            settings = ManifestSettings(kioskPin = KioskPinHash("00", "00", 1)),
        )
        val r = CrashLog.rescue(m)
        assertEquals(listOf("slide"), r.items.map { it.mediaId })
        assertTrue(r.playlists.isEmpty())
        assertNull(r.broadcast)
        assertEquals(m.settings, r.settings) // display hours and the PIN still apply
        assertTrue(CrashLog.rescue(m.copy(fallbackMediaId = null)).items.isEmpty())
    }

    @Test
    fun aDamagedFile_isIgnored() {
        val dir = tmp.newFolder()
        java.io.File(dir, "crashes.json").writeText("{not json")
        assertNull(CrashLog(dir).report())
    }

    @Test
    fun safeMode_playsPostersOnly_andDropsVideoOrLinkBroadcasts() {
        fun item(id: String, type: String) = ManifestItem(mediaId = id, url = "http://tv.test/$id", sha256 = id, size = 1, type = type, durationSec = 10)
        val m = Manifest(
            version = "1",
            items = listOf(item("poster", "IMAGE"), item("video", "VIDEO")),
            playlists = listOf(ManifestPlaylist(id = "p", items = listOf(PlaylistEntry("poster", 10), PlaylistEntry("video", 30)))),
            broadcast = ManifestBroadcast(id = "b", kind = "LINK"),
        )
        val safe = CrashLog.strip(m)
        assertEquals(listOf("poster"), safe.items.map { it.mediaId })
        assertEquals(listOf("poster"), safe.playlists[0].items.map { it.mediaId })
        assertNull(safe.broadcast)

        val message = m.copy(broadcast = ManifestBroadcast(id = "b", kind = "MESSAGE", message = "Branch closed at 2 pm"))
        assertEquals("b", CrashLog.strip(message).broadcast?.id)
        val videoCast = m.copy(broadcast = ManifestBroadcast(id = "b", kind = "MEDIA", media = item("v2", "VIDEO")))
        assertNull(CrashLog.strip(videoCast).broadcast)
    }
}
