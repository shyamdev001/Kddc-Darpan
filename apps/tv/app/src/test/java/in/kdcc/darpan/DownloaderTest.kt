package `in`.kdcc.darpan

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
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

    private fun item(name: String) = ManifestItem(mediaId = name, url = "http://tv.test/$name", sha256 = name, size = 1, type = "IMAGE", durationSec = 10)

    private val stored: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
    private val fetched: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val cleanups: MutableList<Set<String>> = Collections.synchronizedList(mutableListOf())
    private val done = CountDownLatch(1)
    private var authLost = CountDownLatch(1)

    private fun downloader(fetch: (ManifestItem) -> Boolean) = Downloader(
        scope,
        Dispatchers.IO,
        has = { it.sha256 in stored },
        fetch = { item ->
            fetched += item.sha256
            fetch(item).also { if (it) stored += item.sha256 }
        },
        cleanup = { cleanups += it },
        onDone = { done.countDown() },
        onAuthLost = { authLost.countDown() },
        retryDelayMs = 1,
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
}
