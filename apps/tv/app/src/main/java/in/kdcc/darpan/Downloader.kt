package `in`.kdcc.darpan

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * Downloads a manifest's files in the background, one at a time, so a new playlist or an urgent
 * broadcast goes on screen at once instead of waiting for every download to finish.
 *
 * A newer manifest replaces the to-do list: the file being fetched finishes (downloads resume, so
 * nothing is wasted), then the new list starts, the broadcast's own file first. Only one file is
 * ever fetched at a time, so two downloads never write the same partial file.
 */
/**
 * How the newest manifest's files stand, for the heartbeat: the dashboard shows
 * "3 of 12 files missing: storage full" instead of a TV that looks fine but plays old ads.
 */
data class DownloadSummary(val ready: Int, val total: Int, val lastError: String?) {
    val missing: Int get() = total - ready
}

/** Plain words for why a file could not be downloaded. Pure, so it can be tested. */
fun describeDownloadFailure(e: Throwable?): String = when (e) {
    null -> "checksum did not match (file damaged on the way)"
    is NotEnoughSpaceException -> e.message ?: "storage full"
    is ApiException -> "server answered ${e.code}"
    is java.net.UnknownHostException -> "server not found (network or DNS)"
    is java.net.SocketTimeoutException -> "network too slow (timed out)"
    is java.net.ConnectException -> "cannot reach the server"
    else -> "network error: ${e.message ?: e.javaClass.simpleName}".take(160)
}

/**
 * Room for a manifest's new files (docs/AUDIT.md, OF4): checked for all of them before the first
 * download, not file by file, so a nearly full TV does not end up with half a campaign.
 */
object SpacePlan {
    /** Always left free for Android itself. */
    const val RESERVE_BYTES = 200L * 1024 * 1024

    /** Null when [needBytes] fits in [freeBytes] with the reserve left over; otherwise why not, in plain words. */
    fun shortage(needBytes: Long, freeBytes: Long, files: Int): String? =
        if (needBytes <= 0L || freeBytes >= needBytes + RESERVE_BYTES) {
            null
        } else {
            "storage full: needs ${mb(needBytes + RESERVE_BYTES)} MB for $files new file${if (files == 1) "" else "s"}, ${mb(freeBytes)} MB free"
        }

    fun mb(bytes: Long): Long = (bytes + 1_048_575) / 1_048_576
}

class Downloader(
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    /** True when the verified file is already on the TV. */
    private val has: (ManifestItem) -> Boolean,
    /** Blocking. True when the file is verified and in place; false to try again. */
    private val fetch: (ManifestItem) -> Boolean,
    /** Deletes every file whose SHA-256 is not in the set. */
    private val cleanup: (Set<String>) -> Unit,
    /** A pass over the manifest ended: true when every one of its files is in place. */
    private val onDone: (Manifest, Boolean) -> Unit,
    /** The server refused this TV's key (401/403). */
    private val onAuthLost: () -> Unit,
    private val retryDelayMs: Long = 3_000L,
    /** Files to keep besides the manifest being downloaded: the one still on screen (OF2). */
    private val keepAlso: () -> Set<String> = { emptySet() },
    /** Free storage, in bytes. */
    private val freeBytes: () -> Long = { Long.MAX_VALUE },
) {
    private val wanted = Channel<Manifest>(Channel.CONFLATED)

    @Volatile
    private var latest: Manifest? = null

    /** Read by the heartbeat. */
    @Volatile
    var summary: DownloadSummary = DownloadSummary(0, 0, null)
        private set
    private var worker: Job? = null

    /** Returns at once; the downloads happen in the background. */
    fun want(m: Manifest) {
        latest = m
        wanted.trySend(m)
        if (worker == null) worker = scope.launch(io) { loop() }
    }

    private suspend fun loop() {
        for (m in wanted) {
            try {
                process(m)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.code == 401 || e.code == 403) onAuthLost()
            } catch (e: Exception) {
                // Never let one bad file stop the worker; the next manifest or sync tries again.
            }
        }
    }

    /** One pass over [m]'s files. Stops early, with no clean-up, when a newer manifest arrived. */
    private suspend fun process(m: Manifest) {
        val files = (listOfNotNull(m.broadcast?.media) + m.items).distinctBy { it.sha256 }
        var ready = files.count(has)
        var lastError: String? = null
        summary = DownloadSummary(ready, files.size, summary.lastError)
        val missing = files.filterNot(has)
        if (missing.isNotEmpty()) {
            val need = missing.sumOf { it.size }
            // Make room first: files nothing needs any more go before the check, not after the downloads.
            if (SpacePlan.shortage(need, freeBytes(), missing.size) != null) cleanup(keepFor(files))
            val short = SpacePlan.shortage(need, freeBytes(), missing.size)
            if (short != null) {
                // No partial download: the TV keeps playing what it has and says why.
                summary = DownloadSummary(ready, files.size, short)
                onDone(m, false)
                return
            }
        }
        for (item in files) {
            if (latest !== m) return
            if (has(item)) continue
            var failure: Throwable? = null
            var done = false
            for (attempt in 1..ATTEMPTS) {
                done = try {
                    fetch(item).also { failure = null }
                } catch (e: ApiException) {
                    if (e.code == 401 || e.code == 403) throw e
                    failure = e
                    false
                } catch (e: IOException) {
                    failure = e
                    false
                }
                if (done) break
                if (latest !== m) return
                if (attempt < ATTEMPTS) delay(retryDelayMs * attempt)
            }
            if (done) ready++ else lastError = describeDownloadFailure(failure)
            summary = DownloadSummary(ready, files.size, lastError)
        }
        if (latest !== m) return
        summary = DownloadSummary(ready, files.size, lastError)
        cleanup(keepFor(files))
        onDone(m, ready == files.size)
    }

    private fun keepFor(files: List<ManifestItem>): Set<String> = files.map { it.sha256 }.toSet() + keepAlso()

    private companion object {
        const val ATTEMPTS = 3
    }
}
