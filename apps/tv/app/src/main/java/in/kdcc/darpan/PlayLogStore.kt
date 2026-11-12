package `in`.kdcc.darpan

import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Proof of play: one line per item shown, kept in a file until the server has it, so plays made
 * while offline are uploaded later. Playback calls [start] when an item appears and [end] when the
 * screen goes blank; starting the next item ends the previous one.
 */
class PlayLogStore(dir: File) {
    private val file = File(dir, "playlogs.jsonl")
    private val lock = Any()
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    private var openId: String? = null
    private var openWall = 0L
    private var openElapsed = 0L

    fun start(mediaId: String) = synchronized(lock) {
        closeLocked()
        openId = mediaId
        openWall = TrustedClock.now()
        openElapsed = SystemClock.elapsedRealtime()
    }

    fun end() = synchronized(lock) { closeLocked() }

    /** Forget the item on screen without recording it (it failed to play). */
    fun cancel() = synchronized(lock) { openId = null }

    /** Up to [max] saved lines, oldest first. */
    fun pending(max: Int): List<String> = synchronized(lock) {
        if (file.exists()) file.bufferedReader().useLines { lines -> lines.take(max).toList() } else emptyList()
    }

    /** Remove the first [count] lines once the server has them. */
    fun drop(count: Int) {
        synchronized(lock) {
            if (file.exists()) rewrite(file.readLines().drop(count))
        }
    }

    private fun closeLocked() {
        val id = openId ?: return
        openId = null
        val ms = SystemClock.elapsedRealtime() - openElapsed
        if (ms < MIN_MS) return
        val line = JSONObject()
            .put("mediaId", id)
            .put("startedAt", iso.format(openWall))
            .put("durationMs", ms.coerceAtMost(MAX_MS))
            .toString()
        try {
            file.appendText(line + "\n")
            if (file.length() > MAX_BYTES) {
                // Offline for weeks: keep the newest half rather than fill the TV's storage.
                val lines = file.readLines()
                rewrite(lines.drop(lines.size / 2))
                Log.w(TAG, "Play log too large; dropped the oldest ${lines.size / 2} entries")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not save play log", e)
        }
    }

    private fun rewrite(lines: List<String>) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(if (lines.isEmpty()) "" else lines.joinToString("\n", postfix = "\n"))
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    private companion object {
        const val TAG = "PlayLog"
        const val MIN_MS = 1_000L
        const val MAX_MS = 24 * 3_600_000L
        const val MAX_BYTES = 8L * 1024 * 1024 // ~80,000 plays
    }
}
