package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** A new campaign goes on screen in one step, only when all of it is on the TV (docs/AUDIT.md, OF1). */
class ManifestSwitchTest {
    private fun item(id: String, video: Boolean = false, until: String? = null) = ManifestItem(
        mediaId = id, url = "https://x/$id", sha256 = "sha-$id", size = 1, type = if (video) "VIDEO" else "IMAGE",
        durationSec = 10, validUntil = until,
    )

    private fun manifest(version: String, vararg ids: String, extra: List<ManifestItem> = emptyList(), fallback: String? = null) = Manifest(
        version = version,
        items = ids.map { item(it) } + extra,
        playlists = listOf(ManifestPlaylist("p", items = ids.map { PlaylistEntry(it, 10) })),
        fallbackMediaId = fallback,
    )

    private val onTv = mutableSetOf("sha-a", "sha-b", "sha-c")
    private val has: (ManifestItem) -> Boolean = { it.sha256 in onTv }
    private val active = manifest("old", "a", "b", "c")

    @Test
    fun theFirstManifestEver_goesOnAtOnce() {
        assertSame(ManifestSwitch.Decision.Switch, ManifestSwitch.decide(null, manifest("new", "x"), has, 0))
    }

    @Test
    fun aChangeThatNeedsNoDownload_goesOnAtOnce() {
        // Reordered, new hours: every file is already here.
        val reordered = manifest("new", "c", "a").copy(settings = ManifestSettings(hours = DisplayHours(on = "10:00", off = "18:00")))
        assertSame(ManifestSwitch.Decision.Switch, ManifestSwitch.decide(active, reordered, has, 0))
    }

    @Test
    fun aCampaignStillDownloading_leavesTheOldLoopPlaying() {
        val incoming = manifest("new", "a", "b", "c", "x", "y").copy(settings = ManifestSettings(orientation = "PORTRAIT", sync = true))
        val d = ManifestSwitch.decide(active, incoming, has, waitedMs = 60_000)
        val play = (d as ManifestSwitch.Decision.Wait).play
        assertEquals(listOf("a", "b", "c"), play.playlists.single().items.map { it.mediaId })
        assertEquals("old", play.version) // what is on screen is still the old manifest
        // Settings need no download: they apply now.
        assertEquals("PORTRAIT", play.settings.orientation)
        assertEquals(true, play.settings.sync)
    }

    @Test
    fun aRemovedOrEndedAd_stopsAtOnce_evenWhileTheRestDownloads() {
        val incoming = Manifest(
            version = "new",
            items = listOf(item("a", until = "2026-11-18T18:29:59.999Z"), item("c"), item("x")),
            playlists = listOf(ManifestPlaylist("p", items = listOf("a", "c", "x").map { PlaylistEntry(it, 10) })),
        )
        val play = (ManifestSwitch.decide(active, incoming, has, 0) as ManifestSwitch.Decision.Wait).play
        assertEquals(listOf("a", "c"), play.items.map { it.mediaId }) // "b" was pulled
        assertEquals(listOf("a", "c"), play.playlists.single().items.map { it.mediaId })
        assertEquals("2026-11-18T18:29:59.999Z", play.items.first { it.mediaId == "a" }.validUntil) // ended early
    }

    @Test
    fun aBroadcastShowsAtOnce_whileTheCampaignWaits() {
        val urgent = ManifestBroadcast(id = "b1", kind = "MESSAGE", message = "Branch closed at 2 pm")
        val incoming = manifest("new", "a", "x").copy(broadcast = urgent)
        assertEquals(urgent, (ManifestSwitch.decide(active, incoming, has, 0) as ManifestSwitch.Decision.Wait).play.broadcast)
    }

    @Test
    fun theDefaultSlide_changesOnlyOnceTheNewOneIsHere() {
        val old = manifest("old", "a", "b", extra = listOf(item("logo1")), fallback = "logo1")
        onTv += "sha-logo1"
        val incoming = manifest("new", "a", "x", extra = listOf(item("logo2")), fallback = "logo2")
        val waiting = (ManifestSwitch.decide(old, incoming, has, 0) as ManifestSwitch.Decision.Wait).play
        assertEquals("logo1", waiting.fallbackMediaId)
        assertTrue(waiting.items.any { it.mediaId == "logo1" })
        onTv += "sha-logo2"
        assertEquals("logo2", (ManifestSwitch.decide(old, incoming, has, 0) as ManifestSwitch.Decision.Wait).play.fallbackMediaId)
    }

    @Test
    fun neverStuckOnAnOldCampaign() {
        val incoming = manifest("new", "a", "x")
        assertTrue(ManifestSwitch.decide(active, incoming, has, ManifestSwitch.GIVE_UP_MS - 1) is ManifestSwitch.Decision.Wait)
        assertSame(ManifestSwitch.Decision.Switch, ManifestSwitch.decide(active, incoming, has, ManifestSwitch.GIVE_UP_MS))
        // Every old ad removed: the new loop's ready files beat the default slide.
        onTv += "sha-y"
        assertSame(ManifestSwitch.Decision.Switch, ManifestSwitch.decide(active, manifest("new", "x", "y"), has, 0))
    }

    @Test
    fun theFilesKept_areThoseOfTheManifestOnScreenAndTheOneDownloading() {
        val incoming = manifest("new", "a", "x").copy(broadcast = ManifestBroadcast(id = "b", kind = "MEDIA", media = item("clip", video = true)))
        assertEquals(setOf("sha-a", "sha-b", "sha-c", "sha-x", "sha-clip"), ManifestSwitch.keep(active, incoming))
        assertEquals(setOf("sha-a", "sha-b", "sha-c"), ManifestSwitch.keep(active, null))
    }
}
