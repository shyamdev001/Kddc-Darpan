package `in`.kdcc.darpan

import kotlin.math.abs

/**
 * The shared timeline that keeps screens in step (docs: SYNC_DESIGN.md, section 3).
 *
 * Every TV with the same playlist and the same server time works out the same item and the same
 * moment inside it: t = (serverNow - anchor) mod loopLength. Nothing here reads a clock or the
 * cache, so the answer cannot depend on how long a TV has been running or what it has downloaded.
 */
object Timeline {
    /** One slot of the loop: an item and the server's length for it. */
    data class Step(val mediaId: String, val durationMs: Long)

    /** Where the loop is at a moment. */
    data class Position(
        /** Index into the steps. */
        val index: Int,
        /** How far into that step, in ms. */
        val offsetMs: Long,
        /** Server time the step began and ends. */
        val startedAt: Long,
        val endsAt: Long,
        val loopMs: Long,
    )

    /** No step is shorter than this, whatever the manifest says (a 0 s poster would spin the loop). */
    const val MIN_STEP_MS = 1_000L

    fun at(steps: List<Step>, anchorMs: Long, nowMs: Long): Position? {
        if (steps.isEmpty()) return null
        val lengths = steps.map { maxOf(it.durationMs, MIN_STEP_MS) }
        val loop = lengths.sum()
        val t = Math.floorMod(nowMs - anchorMs, loop)
        var start = 0L
        for ((i, len) in lengths.withIndex()) {
            if (t < start + len) {
                val offset = t - start
                return Position(i, offset, nowMs - offset, nowMs - offset + len, loop)
            }
            start += len
        }
        return null // not reached: t < loop
    }

    /**
     * The next moment after [nowMs] at which an ad starts or stops being in its dates. The loop is
     * worked out again then, at the same instant on every screen. Null if nothing changes.
     */
    fun nextChange(bounds: List<Long?>, nowMs: Long): Long? = bounds.filterNotNull().filter { it > nowMs }.minOrNull()

    /** What to do about a video that is [driftMs] off the timeline (positive = ahead). */
    sealed class Correction {
        data class Seek(val toMs: Long) : Correction()
        data class Speed(val speed: Float) : Correction()
    }

    const val SEEK_ABOVE_MS = 500L
    const val NUDGE_ABOVE_MS = 40L
    const val SLOW = 0.98f
    const val FAST = 1.02f
    const val MIN_SEEK_GAP_MS = 1_500L

    /** Seeking takes the player a moment; aim this far ahead so it lands on time. */
    const val SEEK_LEAD_MS = 150L

    /**
     * Big gaps are closed with a seek (at most once every 1.5 s, or the picture would stutter); small
     * ones by playing 2 % faster or slower, which nobody notices; within 40 ms nothing is done.
     */
    fun correction(driftMs: Long, wantMs: Long, msSinceLastSeek: Long): Correction = when {
        abs(driftMs) > SEEK_ABOVE_MS && msSinceLastSeek >= MIN_SEEK_GAP_MS -> Correction.Seek(wantMs + SEEK_LEAD_MS)
        abs(driftMs) > NUDGE_ABOVE_MS -> Correction.Speed(if (driftMs > 0) SLOW else FAST)
        else -> Correction.Speed(1f)
    }
}

/**
 * Turns answers to "what time is it?" into the server's time (docs: SYNC_DESIGN.md, section 1).
 *
 * Each answer gives offset = serverMs + rtt/2 - receivedAt (elapsedRealtime). Slow answers are
 * usually slow one way, which skews them, so only answers close to the quickest are used, and the
 * median of those is taken: one odd answer cannot move the clock.
 */
class OffsetEstimator(private val keep: Int = 16, private val maxAgeMs: Long = 30 * 60_000L) {
    private class Sample(val offset: Long, val rtt: Long, val at: Long)

    private val samples = ArrayDeque<Sample>()

    @Synchronized
    fun add(serverMs: Long, sentAt: Long, receivedAt: Long) {
        val rtt = receivedAt - sentAt
        if (rtt < 0 || rtt > MAX_RTT_MS || serverMs <= 0) return
        samples.addLast(Sample(serverMs + rtt / 2 - receivedAt, rtt, receivedAt))
        while (samples.size > keep) samples.removeFirst()
        while (samples.isNotEmpty() && receivedAt - samples.first().at > maxAgeMs) samples.removeFirst()
    }

    /** Server time minus elapsedRealtime; null before the first answer. */
    @Synchronized
    fun offset(): Long? {
        val good = usable() ?: return null
        val sorted = good.map { it.offset }.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[mid] else (sorted[mid - 1] + sorted[mid]) / 2
    }

    /** How far off the offset can be: half the quickest round trip. */
    @Synchronized
    fun errorMs(): Long? = samples.minOfOrNull { it.rtt }?.let { (it + 1) / 2 }

    @Synchronized
    fun count(): Int = samples.size

    private fun usable(): List<Sample>? {
        if (samples.isEmpty()) return null
        val minRtt = samples.minOf { it.rtt }
        val limit = minRtt * 3 / 2 + RTT_SLACK_MS
        return samples.filter { it.rtt <= limit }
    }

    companion object {
        const val MAX_RTT_MS = 3_000L
        const val RTT_SLACK_MS = 20L
    }
}
