package `in`.kdcc.darpan

import android.os.SystemClock

/**
 * The server's clock, for keeping playlists and broadcasts in step across screens.
 * TV clocks are often seconds apart; two TVs showing "the same second" by their own clocks would
 * visibly differ. DeviceLink asks the server for its time in short bursts and [OffsetEstimator]
 * turns the answers into one offset (quick answers only, median of those).
 * Until the first answer arrives this falls back to [TrustedClock].
 */
object SyncClock {
    private val estimator = OffsetEstimator()

    /** Server time minus elapsedRealtime (which never jumps, unlike the wall clock). */
    @Volatile
    private var base: Long? = null

    fun now(): Long = base?.let { SystemClock.elapsedRealtime() + it } ?: TrustedClock.now()

    /** True once the server has answered since the app started. */
    val synced: Boolean get() = base != null

    /** How far [now] can be from the server's time, in ms; null before the first answer. */
    fun errorMs(): Long? = estimator.errorMs()

    /** One answer: the server said `serverMs`; we asked at `sentAt` and heard back at `receivedAt` (elapsedRealtime). */
    fun sample(serverMs: Long, sentAt: Long, receivedAt: Long) {
        estimator.add(serverMs, sentAt, receivedAt)
        estimator.offset()?.let { base = it }
    }
}
