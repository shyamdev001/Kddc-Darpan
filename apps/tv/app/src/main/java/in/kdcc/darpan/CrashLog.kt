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
    val rescueUntil: Long = 0,
    /** The app version that went into rescue mode; a new version starts fresh. */
    val rescueVersion: Int = 0,
    /** When the next start may run the app (elapsedRealtime of this boot), or 0. */
    val restartDue: Long = 0,
)

/**
 * Remembers why the app crashed, so head office can see it instead of a TV that just blinks
 * "online, offline, online", and keeps a crash loop from running for ever (K2):
 * - every crash waits longer before the app runs again (3 s up to 5 min, [restartDelayMs]);
 * - after [SAFE_CRASHES] crashes within [SAFE_WINDOW_MS]: safe mode for [SAFE_FOR_MS], posters only;
 * - after a crash in safe mode, or [RESCUE_CRASHES] within [RESCUE_WINDOW_MS]: rescue mode. Only the
 *   default slide shows, no playlists, broadcasts or video, but the TV keeps syncing and installing
 *   updates and allows adb, so it can be fixed from head office or by a technician without a reset.
 *   It ends an hour after the last crash, on a remote restart, or when a new app version starts.
 *
 * Plain file, written synchronously: it runs inside the crash handler, just before the process dies.
 */
class CrashLog(dir: File, private val versionCode: Int = 0) {
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
    var rescueUntil: Long = 0
        private set
    private var rescueVersion: Int = 0
    /** elapsedRealtime when the app may run again after the last crash, or 0. */
    var restartDue: Long = 0
        private set

    init {
        load()
    }

    /** Posters only: in safe mode, and also in rescue mode. */
    fun inSafeMode(now: Long = System.currentTimeMillis()): Boolean = now < safeUntil || inRescue(now)

    /** A clock set back cannot stretch rescue mode beyond an hour. */
    fun inRescue(now: Long = System.currentTimeMillis()): Boolean =
        rescueVersion == versionCode && now < rescueUntil && rescueUntil - now <= RESCUE_FOR_MS

    /**
     * How long this start must wait before running the app (ms), 0 when it may run now. A start
     * sooner than the crash log allows (Android reopening its home app, the watchdog) waits here
     * instead of crashing again at once. A value from another boot (larger than any wait) is ignored.
     */
    fun coolDownMs(elapsedNow: Long): Long {
        val wait = restartDue - elapsedNow
        return if (wait in 1..MAX_DELAY_MS) wait else 0
    }

    /**
     * Called from the crash handler. Never throws. Returns how long to wait before the next start.
     * [elapsedNow] is SystemClock.elapsedRealtime(), so a wrong wall clock does not move the wait.
     */
    fun record(error: Throwable, now: Long = System.currentTimeMillis(), elapsedNow: Long = 0): Long {
        try {
            val root = generateSequence(error) { it.cause }.last()
            last = CrashInfo(
                at = now,
                type = root.javaClass.name,
                message = root.message?.take(200),
                frames = root.stackTrace.take(5).map { "${it.className.substringAfterLast('.')}.${it.methodName}:${it.lineNumber}" },
            )
            val wasSafe = inSafeMode(now)
            times = (times + now).filter { now - it < KEEP_MS }.takeLast(20)
            total++
            if (inRescue(now) || shouldEnterRescue(times, now, wasSafe)) {
                rescueUntil = now + RESCUE_FOR_MS // an hour after the last crash
                rescueVersion = versionCode
            }
            if (shouldEnterSafeMode(times, now)) safeUntil = now + SAFE_FOR_MS
            val delay = restartDelayMs(times, now)
            restartDue = elapsedNow + delay
            save()
            return delay
        } catch (_: Throwable) {
            // Nothing more can be done while crashing.
            return MAX_DELAY_MS
        }
    }

    /** Head office restarted the app on purpose: leave safe and rescue mode and try everything again. */
    fun clearSafeMode() {
        safeUntil = 0
        rescueUntil = 0
        restartDue = 0
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
            rescueUntil = f.rescueUntil
            rescueVersion = f.rescueVersion
            restartDue = f.restartDue
        } catch (_: Exception) {
            // A damaged file only loses the crash history.
        }
    }

    private fun save() {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(CrashFile(times, total, safeUntil, last, rescueUntil, rescueVersion, restartDue)))
        tmp.renameTo(file)
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }
        const val SAFE_CRASHES = 5
        const val SAFE_WINDOW_MS = 10 * 60_000L
        const val SAFE_FOR_MS = 60 * 60_000L
        const val RESCUE_CRASHES = 10
        const val RESCUE_WINDOW_MS = 30 * 60_000L
        const val RESCUE_FOR_MS = 60 * 60_000L
        const val MAX_DELAY_MS = 5 * 60_000L
        private const val KEEP_MS = 60 * 60_000L

        /** 5 crashes within 10 minutes. */
        fun shouldEnterSafeMode(times: List<Long>, now: Long): Boolean = times.count { now - it < SAFE_WINDOW_MS } >= SAFE_CRASHES

        /** A crash while already in safe mode, or 10 within 30 minutes. */
        fun shouldEnterRescue(times: List<Long>, now: Long, wasSafe: Boolean): Boolean =
            wasSafe || times.count { now - it < RESCUE_WINDOW_MS } >= RESCUE_CRASHES

        /** 3 s after the first crash, then 10 s, 30 s, 2 min, and 5 min from the fifth crash in 30 minutes. */
        fun restartDelayMs(times: List<Long>, now: Long): Long = when (times.count { now - it < RESCUE_WINDOW_MS }) {
            0, 1 -> 3_000L
            2 -> 10_000L
            3 -> 30_000L
            4 -> 2 * 60_000L
            else -> MAX_DELAY_MS
        }

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

        /**
         * What rescue mode shows: only the default slide (Playback shows it when nothing else can
         * play), no playlists and no broadcast. Settings stay, so display hours and the PIN still apply.
         */
        fun rescue(m: Manifest): Manifest {
            val slide = m.items.filter { it.mediaId == m.fallbackMediaId && !it.isVideo }
            return m.copy(items = slide, playlists = emptyList(), broadcast = null)
        }
    }
}
