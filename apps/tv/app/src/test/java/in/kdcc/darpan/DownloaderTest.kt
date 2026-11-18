package `in`.kdcc.darpan

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Downloads never hold up the screen, and an urgent broadcast's file jumps the queue. */
class DownloaderTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @After
    fun tearDown() = scope.cancel()

    private fun item(name: String, size: Long = 1) = ManifestItem(mediaId = name, url = "http://tv.test/$name", sha256 = name, size = size, type = "IMAGE", durationSec = 10)

    private val stored: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
    private val fetched: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val cleanups: MutableList<Set<String>> = Collections.synchronizedList(mutableListOf())
    private val completes: MutableList<Boolean> = Collections.synchronizedList(mutableListOf())
    private val done = CountDownLatch(1)
    private var authLost = CountDownLatch(1)

    private fun downloader(
        keepAlso: Set<String> = emptySet(),
        freeBytes: Long = Long.MAX_VALUE,
        fetch: (ManifestItem) -> Boolean,
    ) = Downloader(
        scope,
        Dispatchers.IO,
        has = { it.sha256 in stored },
        fetch = { item ->
            fetched += item.sha256
            fetch(item).also { if (it) stored += item.sha256 }
        },
        cleanup = { cleanups += it },
        onDone = { _, complete ->
            completes += complete
            done.countDown()
        },
        onAuthLost = { authLost.countDown() },
        retryDelayMs = 1,
        keepAlso = { keepAlso },
        freeBytes = { freeBytes },
    )

    @Test
    fun aBroadcastArrivingMidDownload_isNotHeldUp_andItsFileGoesNext() {
        val bigVideoStarted = CountDownLatch(1)
        val releaseBigVideo = CountDownLatch(1)
        val d = downloader { item ->
            if (item.sha256 == "big-video") {
                bigVideoStarted.countDown()
                releaseBigVideo.await(10, TimeUnit.SECONDS) // a 40 MB video on a slow branch link
            }
            true
        }
        d.want(Manifest(version = "1", items = listOf(item("big-video"), item("poster-a"), item("poster-b"))))
        assertTrue(bigVideoStarted.await(5, TimeUnit.SECONDS))

        val broadcast = Manifest(
            version = "2",
            items = listOf(item("big-video"), item("poster-a"), item("poster-b")),
            broadcast = ManifestBroadcast(id = "b1", kind = "MEDIA", media = item("urgent")),
        )
        val start = System.nanoTime()
        d.want(broadcast) // what sync() calls right after putting the broadcast on screen
        val tookMs = (System.nanoTime() - start) / 1_000_000
        assertTrue("want() must return at once, took $tookMs ms", tookMs < 1_000)

        releaseBigVideo.countDown()
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertEquals(listOf("big-video", "urgent", "poster-a", "poster-b"), fetched.toList())
        assertEquals("only the newest list is cleaned up", listOf(setOf("urgent", "big-video", "poster-a", "poster-b")), cleanups.toList())
    }

    @Test
    fun filesAlreadyOnTheTv_areNotFetchedAgain() {
        stored += "poster-a"
        val d = downloader { true }
        d.want(Manifest(version = "1", items = listOf(item("poster-a"), item("poster-b"))))
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertEquals(listOf("poster-b"), fetched.toList())
    }

    @Test
    fun aFailedFile_isTriedThreeTimes_thenTheRestStillDownload() {
        val d = downloader { it.sha256 != "broken" }
        d.want(Manifest(version = "1", items = listOf(item("broken"), item("poster-b"))))
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertEquals(listOf("broken", "broken", "broken", "poster-b"), fetched.toList())
    }

    @Test
    fun aRefusedKey_isReported() {
        val d = downloader { throw ApiException(401, "Unknown device") }
        d.want(Manifest(version = "1", items = listOf(item("poster-a"))))
        assertTrue(authLost.await(5, TimeUnit.SECONDS))
        assertTrue(cleanups.isEmpty())
    }

    @Test
    fun theSummary_saysHowManyFilesAreMissingAndWhy() {
        stored += "poster-a"
        val d = downloader { item ->
            when (item.sha256) {
                "big-video" -> throw NotEnoughSpaceException("storage full: needs 240 MB, 120 MB free")
                else -> true
            }
        }
        d.want(Manifest(version = "1", items = listOf(item("poster-a"), item("big-video"), item("poster-b"))))
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertEquals(DownloadSummary(ready = 2, total = 3, lastError = "storage full: needs 240 MB, 120 MB free"), d.summary)
        assertEquals(1, d.summary.missing)
    }

    @Test
    fun whenEverythingArrives_theErrorClears() {
        var failOnce = true
        val d = downloader { item ->
            if (item.sha256 == "poster-b" && failOnce) {
                failOnce = false
                throw java.net.SocketTimeoutException("timeout")
            }
            true
        }
        d.want(Manifest(version = "1", items = listOf(item("poster-a"), item("poster-b"))))
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertEquals(DownloadSummary(ready = 2, total = 2, lastError = null), d.summary)
    }

    @Test
    fun aPass_saysWhetherEveryFileArrived() {
        val d = downloader { it.sha256 != "broken" }
        d.want(Manifest(version = "1", items = listOf(item("broken"), item("poster-b"))))
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertEquals(listOf(false), completes.toList()) // so the TV keeps its old manifest on screen
    }

    @Test
    fun theFilesOfTheManifestOnScreen_areKept() {
        val d = downloader(keepAlso = setOf("old-poster")) { true }
        d.want(Manifest(version = "2", items = listOf(item("new-poster"))))
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertEquals(listOf(setOf("new-poster", "old-poster")), cleanups.toList())
        assertEquals(listOf(true), completes.toList())
    }

    @Test
    fun notEnoughRoomForTheWholeCampaign_downloadsNothing_andSaysHowMuchIsNeeded() {
        val mb = 1_048_576L
        val d = downloader(freeBytes = 300 * mb) { true }
        // 40 + 80 MB new, 300 MB free: 120 + 200 reserve does not fit.
        d.want(Manifest(version = "1", items = listOf(item("video-1", 40 * mb), item("video-2", 80 * mb))))
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertTrue("nothing fetched", fetched.isEmpty())
        assertEquals("unneeded files are cleared first", 1, cleanups.size)
        assertEquals(listOf(false), completes.toList())
        assertEquals(DownloadSummary(0, 2, "storage full: needs 320 MB for 2 new files, 300 MB free"), d.summary)
        assertEquals(null, SpacePlan.shortage(120 * mb, 320 * mb, 2))
        assertEquals(null, SpacePlan.shortage(0, 0, 0))
    }

    @Test
    fun failures_areDescribedInPlainWords() {
        assertEquals("checksum did not match (file damaged on the way)", describeDownloadFailure(null))
        assertEquals("server answered 404", describeDownloadFailure(ApiException(404, "Not found")))
        assertEquals("network too slow (timed out)", describeDownloadFailure(java.net.SocketTimeoutException()))
        assertEquals("storage full: needs 1 MB, 0 MB free", describeDownloadFailure(NotEnoughSpaceException("storage full: needs 1 MB, 0 MB free")))
        // A WiFi sign-in or proxy page, not "checksum did not match" (OF8).
        assertEquals("a network sign-in or proxy page answered instead of the server", describeDownloadFailure(SignInPageException()))
    }

    @Test
    fun aWebPageReply_isRecognised_soItIsNeverTakenForALostKey() {
        assertTrue(isWebPage("text/html"))
        assertTrue(isWebPage("text/HTML; charset=iso-8859-1"))
        assertFalse(isWebPage("application/json; charset=utf-8"))
        assertFalse(isWebPage("image/jpeg"))
        assertFalse(isWebPage("video/mp4"))
        assertFalse(isWebPage(null))
        val e: java.io.IOException = SignInPageException()
        assertFalse(e is ApiException) // so a proxy's 403 page never starts re-pairing
    }
}
