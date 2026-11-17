package `in`.kdcc.darpan

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/** The last crash, short enough for a heartbeat. */
@Serializable
data class CrashInfo(
    val at: Long,
    /** Exception class, e.g. "java.lang.OutOfMemoryError". */
    val type: String,
    val message: String?,
    /** Top stack frames, innermost first. */
    val frames: List<String>,
)

/** Sent in the heartbeat as "crash". */
@Serializable
data class CrashReport(
    val at: Long,
    val type: String,
    val message: String?,
    val frames: List<String>,
    /** Every crash since install. */
    val total: Int,
    /** Crashes in the last 10 minutes. */
    val recent: Int,
)

@Serializable
private data class CrashFile(
    val times: List<Long> = emptyList(),
    val total: Int = 0,
    val safeUntil: Long = 0,
    val last: CrashInfo? = null,
)

/**
 * Remembers why the app crashed, so head office can see it instead of a TV that just blinks
 * "online, offline, online". After [SAFE_CRASHES] crashes within [SAFE_WINDOW_MS] the app starts in
 * safe mode for [SAFE_FOR_MS]: posters only, no video and no live links (the usual crash causes on
 * low-memory TVs), so the screen keeps showing ads while someone looks into it.
 *
 * Plain file, written synchronously: it runs inside the crash handler, just before the process dies.
 */
class CrashLog(dir: File) {
    private val file = File(dir, "crashes.json")

    /** Crash times, oldest first (only the recent ones are kept). */
    var times: List<Long> = emptyList()
        private set
    var last: CrashInfo? = null
        private set
    /** Every crash since install. */
    var total: Int = 0
        private set
    /** Safe mode lasts until this time (ms), or 0. */
    var safeUntil: Long = 0
        private set

    init {
        load()
    }

    fun inSafeMode(now: Long = System.currentTimeMillis()): Boolean = now < safeUntil

    /** Called from the crash handler. Never throws. */
    fun record(error: Throwable, now: Long = System.currentTimeMillis()) {
        try {
            val root = generateSequence(error) { it.cause }.last()
            last = CrashInfo(
                at = now,
                type = root.javaClass.name,
                message = root.message?.take(200),
                frames = root.stackTrace.take(5).map { "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}" },
            )
            times = (times + now).filter { now - it < SAFE_WINDOW_MS * 6 }.takeLast(20)
            total++
            if (shouldEnterSafeMode(times, now)) safeUntil = now + SAFE_FOR_MS
            save()
        } catch (_: Throwable) {
            // Nothing more can be done while crashing.
        }
    }

    /** Head office restarted the app on purpose: leave safe mode and try everything again. */
    fun clearSafeMode() {
        safeUntil = 0
        times = emptyList()
        save()
    }

    /** For the heartbeat; null when the app never crashed. */
    fun report(now: Long = System.currentTimeMillis()): CrashReport? {
        val c = last ?: return null
        return CrashReport(c.at, c.type, c.message, c.frames, total, times.count { now - it < SAFE_WINDOW_MS })
    }

    private fun load() {
        try {
            if (!file.exists()) return
            val f = json.decodeFromString<CrashFile>(file.readText())
            times = f.times
            total = f.total
            safeUntil = f.safeUntil
            last = f.last
        } catch (_: Exception) {
            // A damaged file only loses the crash history.
        }
    }

    private fun save() {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(CrashFile(times, total, safeUntil, last)))
        tmp.renameTo(file)
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }
        const val SAFE_CRASHES = 5
        const val SAFE_WINDOW_MS = 10 * 60_000L
        const val SAFE_FOR_MS = 60 * 60_000L

        /** 5 crashes within 10 minutes. */
        fun shouldEnterSafeMode(times: List<Long>, now: Long): Boolean = times.count { now - it < SAFE_WINDOW_MS } >= SAFE_CRASHES

        /** What safe mode plays: posters only, and no broadcast that needs video or a web page. */
        fun strip(m: Manifest): Manifest {
            val images = m.items.filter { !it.isVideo }
            val keep = images.map { it.mediaId }.toSet()
            val broadcast = m.broadcast?.takeIf { it.kind == "MESSAGE" || (it.kind == "MEDIA" && it.media?.isVideo == false) }
            return m.copy(
                items = images,
                playlists = m.playlists.map { p -> p.copy(items = p.items.filter { it.mediaId in keep }) },
                broadcast = broadcast,
            )
        }
    }
}
