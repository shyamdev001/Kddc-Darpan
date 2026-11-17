package `in`.kdcc.darpan

/** Recorded as a crash when the player stopped moving, so head office sees it and safe mode counts it. */
class PlaybackStalledException(minutes: Long) : RuntimeException("Playback did not move for $minutes minutes; app restarted")

/**
 * Proof that the player loop is moving. It beats once per item (and every few seconds while idle or
 * outside display hours); a background check restarts the app when it stops beating, which the
 * on-screen watchdog cannot see: the app is "visible", but the picture is frozen.
 */
object PlaybackPulse {
    /** No beat for this long beyond the current item's own length counts as stuck. */
    const val STALL_MS = 10 * 60_000L

    @Volatile private var run = 0
    @Volatile private var watching = false
    @Volatile private var beatAt = 0L
    @Volatile private var busyUntil = 0L

    /** The player loop started; returns its id for [stop]. */
    fun start(now: Long): Int {
        run++
        watching = true
        beatAt = now
        busyUntil = now
        return run
    }

    /** The loop is alive; the next beat is due after [busyMs] (the item's own length). */
    fun beat(now: Long, busyMs: Long = 0) {
        beatAt = now
        busyUntil = now + busyMs.coerceAtLeast(0)
    }

    /** The loop ended on purpose (broadcast, unpaired, closing). A newer loop is left alone. */
    fun stop(id: Int) {
        if (id == run) watching = false
    }

    /** How long the player has been stuck, or null. */
    fun stalledFor(now: Long): Long? = stalled(watching, beatAt, busyUntil, now)

    /** Pure rule. Measured from the end of the item on screen, so a long video is not "stuck". */
    fun stalled(watching: Boolean, beatAt: Long, busyUntil: Long, now: Long, limit: Long = STALL_MS): Long? {
        if (!watching) return null
        val quiet = now - maxOf(beatAt, busyUntil)
        return if (quiet > limit) now - beatAt else null
    }
}
