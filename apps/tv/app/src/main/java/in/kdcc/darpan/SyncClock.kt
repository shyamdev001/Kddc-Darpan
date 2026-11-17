package `in`.kdcc.darpan

import android.os.SystemClock

/**
 * The server's clock, to the tenth of a second, for keeping broadcasts in step across screens.
 * TV clocks are often a few seconds apart; two TVs showing "the same second" of a video by
 * their own clocks would visibly differ. DeviceLink asks the server for its time now and then and
 * measures how long the answer took; the quickest answer is the most accurate, so it is kept.
 * Until the first answer arrives this falls back to [TrustedClock].
 */
object SyncClock {
    /** Server time minus elapsedRealtime (which never jumps, unlike the wall clock). */
    @Volatile
    private var base: Long? = null
    private var bestRtt = Long.MAX_VALUE
    private var bestAt = 0L

    fun now(): Long = base?.let { SystemClock.elapsedRealtime() + it } ?: TrustedClock.now()

    /** One answer: the server said `serverMs`; we asked at `sentAt` and heard back at `receivedAt` (elapsedRealtime). */
    @Synchronized
    fun sample(serverMs: Long, sentAt: Long, receivedAt: Long) {
        val rtt = receivedAt - sentAt
        if (rtt < 0 || rtt > MAX_RTT_MS) return
        // A quicker answer wins; an old best is replaced anyway, as the TV's tick drifts slowly.
        if (rtt <= bestRtt || receivedAt - bestAt > STALE_MS) {
            bestRtt = rtt
            bestAt = receivedAt
            base = serverMs + rtt / 2 - receivedAt
        }
    }

    private const val MAX_RTT_MS = 3_000L
    private const val STALE_MS = 30 * 60_000L
}
