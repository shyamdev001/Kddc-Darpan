package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/** What a branch kept in step plays: the same answer on every screen, whatever each has downloaded. */
class SyncPlanTest {
    private fun ist(s: String): Long = LocalDateTime.parse(s).atZone(ZoneId.of("Asia/Kolkata")).toInstant().toEpochMilli()

    /** The server's format: UTC with milliseconds. */
    private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString().let { if (it.length == 20) it.dropLast(1) + ".000Z" else it }

    private fun item(id: String, video: Boolean = false, from: Long? = null, until: Long? = null) = ManifestItem(
        mediaId = id, url = "https://x/$id", sha256 = "sha-$id", size = 1, type = if (video) "VIDEO" else "IMAGE",
        durationSec = if (video) 30 else 10, validFrom = from?.let { iso(it) }, validUntil = until?.let { iso(it) },
    )

    private val now = ist("2026-11-17T11:00:00")
    private val endsSoon = ist("2026-11-17T23:59:59")
    private val items = listOf(item("a"), item("b", until = endsSoon), item("v", video = true), item("c", from = ist("2026-12-01T00:00")))
    private val always = ManifestPlaylist("always", items = listOf(PlaylistEntry("a", 10), PlaylistEntry("b", 8), PlaylistEntry("v", 30), PlaylistEntry("c", 10)))
    private val morning = ManifestPlaylist("morning", slots = listOf(TimeSlot(start = "10:00", end = "12:00")), items = listOf(PlaylistEntry("v", 30), PlaylistEntry("a", 5)))

    @Test
    fun theLoopComesFromTheManifest_withItsDatesAndTheServersLengths() {
        val plan = SyncPlan.at(Manifest("1", items = items, playlists = listOf(always)), now, clockCertain = true)!!
        // "c" starts next month: not in the loop. Lengths are the playlist's, never the player's.
        assertEquals(listOf("a" to 10_000L, "b" to 8_000L, "v" to 30_000L), plan.steps.map { it.mediaId to it.durationMs })
        assertEquals(0L, plan.anchorMs)
        // "b" ends tonight: the loop is worked out again a moment after, on every screen at once.
        assertEquals(endsSoon + 1, plan.changesAt)
        val later = SyncPlan.at(Manifest("1", items = items, playlists = listOf(always)), endsSoon + 1, clockCertain = true)!!
        assertEquals(listOf("a", "v"), later.steps.map { it.mediaId })
        assertNotEquals(plan.key, later.key)
    }

    @Test
    fun aTimedPlaylistStartsAtItsSlot_andWaitsWhileTheClockIsUnsure() {
        val m = Manifest("1", items = items, playlists = listOf(morning, always))
        val plan = SyncPlan.at(m, now, clockCertain = true)!!
        assertEquals(listOf("v", "a"), plan.steps.map { it.mediaId })
        assertEquals(ist("2026-11-17T10:00"), plan.anchorMs)
        // A TV that does not know the time plays the always-on layer only.
        assertEquals(listOf("a", "b", "v"), SyncPlan.at(m, now, clockCertain = false)!!.steps.map { it.mediaId })
        // Outside the slot: the always-on playlist.
        assertEquals("always", SyncPlan.at(m, ist("2026-11-17T12:00"), true)!!.key.substringBefore("@"))
    }

    @Test
    fun twoScreensTurnedOnAtDifferentTimesShowTheSameStep() {
        val m = Manifest("1", items = items, playlists = listOf(always))
        val at = ist("2026-11-17T15:42:07.250")
        val a = SyncPlan.at(m, at, true)!!
        val b = SyncPlan.at(m.copy(version = "1"), at, true)!!
        assertEquals(Timeline.at(a.steps, a.anchorMs, at), Timeline.at(b.steps, b.anchorMs, at))
    }

    @Test
    fun nothingInItsDates_meansNothingToPlay() {
        val old = item("x", until = now - 1)
        assertNull(SyncPlan.at(Manifest("1", items = listOf(old), playlists = listOf(ManifestPlaylist("p", items = listOf(PlaylistEntry("x", 10))))), now, true))
        assertNull(SyncPlan.at(Manifest("1"), now, true))
    }

    @Test
    fun timeSlotsChangeOnWholeMinutes() {
        assertEquals(ist("2026-11-17T10:01"), SyncPlan.nextMinute(ist("2026-11-17T10:00:59.999")))
        assertEquals(ist("2026-11-17T10:01"), SyncPlan.nextMinute(ist("2026-11-17T10:00")))
    }
}
