package `in`.kdcc.darpan

import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Proof of play: one line per item shown, kept in a file until the server has it, so plays made
 * while offline are uploaded later. Playback calls [start] when an item appears and [end] when the
 * screen goes blank; starting the next item ends the previous one.
 */
class PlayLogStore(
    dir: File,
    /** Same value for every start of the app until the TV reboots (elapsedRealtime restarts then). */
    private val bootId: String,
) {
    private val file = File(dir, "playlogs.jsonl")
    private val lock = Any()
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    private var openId: String? = null
    private var openWall = 0L
    private var openElapsed = 0L
    private var openUncertain = false

    fun start(mediaId: String) = synchronized(lock) {
        closeLocked()
        openId = mediaId
        openWall = TrustedClock.now()
        openUncertain = !TrustedClock.certain
        openElapsed = SystemClock.elapsedRealtime()
    }

    fun end() = synchronized(lock) { closeLocked() }

    /** Forget the item on screen without recording it (it failed to play). */
    fun cancel() = synchronized(lock) { openId = null }

    /**
     * Up to [max] saved lines, oldest first, ready to send: one per saved line, so [drop] can count
     * them. A play recorded while the clock was unsure gets its real time back if the clock has been
     * set since, in the same boot; otherwise it goes with `clockUncertain: true`.
     */
    fun pending(max: Int): List<String> = synchronized(lock) {
        val lines = if (file.exists()) file.bufferedReader().useLines { it.take(max).toList() } else emptyList()
        val certain = TrustedClock.certain
        val nowMs = if (certain) TrustedClock.now() else 0L
        val nowElapsed = SystemClock.elapsedRealtime()
        lines.map { line -> forServer(line, certain, nowMs, nowElapsed) }
    }

    private fun forServer(line: String, certain: Boolean, nowMs: Long, nowElapsed: Long): String {
        val o = try {
            JSONObject(line)
        } catch (e: Exception) {
            return line // cut short by a power cut; the uploader skips it
        }
        if (!o.optBoolean("clockUncertain", false)) return line
        val fixed = if (certain) restamp(o.optLong("elapsedAt", -1), o.optString("boot"), bootId, nowMs, nowElapsed) else null
        val out = JSONObject().put("mediaId", o.optString("mediaId")).put("durationMs", o.optLong("durationMs"))
        // Same id whatever time it goes with, so a resend with the corrected time counts once (OF11).
        o.optString("playId").takeIf { it.isNotEmpty() }?.let { out.put("playId", it) }
        return if (fixed != null) {
            out.put("startedAt", iso.format(fixed)).toString()
        } else {
            out.put("startedAt", o.optString("startedAt")).put("clockUncertain", true).toString()
        }
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
        val o = JSONObject()
            .put("mediaId", id)
            .put("startedAt", iso.format(openWall))
            .put("durationMs", ms.coerceAtMost(MAX_MS))
            .put("playId", UUID.randomUUID().toString()) // the server counts each id once (OF11)
        // Kept only on the TV, to put the right time on it later (see pending).
        if (openUncertain) o.put("clockUncertain", true).put("elapsedAt", openElapsed).put("boot", bootId)
        val line = o.toString()
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
        // On disk before the rename, as ManifestStore does: a power cut must not leave an empty
        // file and lose plays not yet sent (OF10).
        FileOutputStream(tmp).use { out ->
            out.write((if (lines.isEmpty()) "" else lines.joinToString("\n", postfix = "\n")).toByteArray(Charsets.UTF_8))
            out.fd.sync()
        }
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    companion object {
        /**
         * The real start of a play recorded while the clock was unsure, once the time is known: the
         * elapsed-time stamp only means something within the same boot. Null when it cannot be known.
         */
        fun restamp(elapsedAt: Long, lineBoot: String, boot: String, nowMs: Long, nowElapsed: Long): Long? =
            if (lineBoot == boot && elapsedAt in 0..nowElapsed) nowMs - (nowElapsed - elapsedAt) else null

        private const val TAG = "PlayLog"
        private const val MIN_MS = 1_000L
        private const val MAX_MS = 24 * 3_600_000L
        private const val MAX_BYTES = 8L * 1024 * 1024 // ~80,000 plays
    }
}
