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
class Downloader(
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    /** True when the verified file is already on the TV. */
    private val has: (ManifestItem) -> Boolean,
    /** Blocking. True when the file is verified and in place; false to try again. */
    private val fetch: (ManifestItem) -> Boolean,
    /** Deletes files the finished manifest no longer needs (by SHA-256). */
    private val cleanup: (Set<String>) -> Unit,
    /** Every file of the newest manifest is in place. */
    private val onDone: () -> Unit,
    /** The server refused this TV's key (401/403). */
    private val onAuthLost: () -> Unit,
    private val retryDelayMs: Long = 3_000L,
) {
    private val wanted = Channel<Manifest>(Channel.CONFLATED)

    @Volatile
    private var latest: Manifest? = null
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
                if (process(m)) onDone()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.code == 401 || e.code == 403) onAuthLost()
            } catch (e: Exception) {
                // Never let one bad file stop the worker; the next manifest or sync tries again.
            }
        }
    }

    /** False when a newer manifest arrived part-way; that one is handled next. */
    private suspend fun process(m: Manifest): Boolean {
        val files = (listOfNotNull(m.broadcast?.media) + m.items).distinctBy { it.sha256 }
        for (item in files) {
            if (latest !== m) return false
            if (has(item)) continue
            for (attempt in 1..ATTEMPTS) {
                val done = try {
                    fetch(item)
                } catch (e: ApiException) {
                    if (e.code == 401 || e.code == 403) throw e
                    false
                } catch (e: IOException) {
                    false
                }
                if (done) break
                if (latest !== m) return false
                if (attempt < ATTEMPTS) delay(retryDelayMs * attempt)
            }
        }
        if (latest !== m) return false
        cleanup(files.map { it.sha256 }.toSet())
        return true
    }

    private companion object {
        const val ATTEMPTS = 3
    }
}
