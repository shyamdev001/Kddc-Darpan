package `in`.kdcc.darpan

import kotlin.random.Random

/**
 * Waits between retries that grow and are spread at random (docs: AUDIT.md, OF5). 101 TVs that failed
 * at the same moment (a server restart, the bank's internet back) then try again over a spread of
 * seconds, not all in the same one.
 */
class Backoff(private val firstMs: Long, private val maxMs: Long, private val random: Random = Random.Default) {
    private var attempt = 0

    /** The next wait: [firstMs], doubling up to [maxMs], each one at random between half and one and a half times that. */
    fun next(): Long {
        val base = if (attempt >= 30) maxMs else minOf(maxMs, firstMs shl attempt)
        attempt++
        return spread(base, random)
    }

    /** It worked: the next failure starts from [firstMs] again. */
    fun reset() {
        attempt = 0
    }

    companion object {
        /** [ms] ± 50 %, at random. */
        fun spread(ms: Long, random: Random = Random.Default): Long = (ms * (0.5 + random.nextDouble())).toLong()
    }
}
