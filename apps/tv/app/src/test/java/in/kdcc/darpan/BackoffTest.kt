package `in`.kdcc.darpan

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** Retries grow, stay within bounds, and 101 TVs that failed together spread out (OF5). */
class BackoffTest {
    @Test
    fun growsToTheLimit_withinHalfAndOneAndAHalfTimes() {
        val b = Backoff(firstMs = 30_000, maxMs = 300_000, random = Random(7))
        val expected = listOf(30_000L, 60_000L, 120_000L, 240_000L, 300_000L, 300_000L, 300_000L)
        for (base in expected) {
            val wait = b.next()
            assertTrue("$wait for $base", wait >= base / 2 && wait <= base * 3 / 2)
        }
        // Long outages never overflow: still within the limit after many tries.
        repeat(100) { assertTrue(b.next() <= 450_000L) }
    }

    @Test
    fun startsAgainAfterItWorked() {
        val b = Backoff(30_000, 300_000, Random(1))
        repeat(5) { b.next() }
        b.reset()
        val wait = b.next()
        assertTrue(wait in 15_000L..45_000L)
    }

    @Test
    fun aHundredAndOneTvsFailingTogether_doNotAllRetryInTheSameSecond() {
        val seconds = (0 until 101).map { tv -> Backoff(30_000, 300_000, Random(tv)).next() / 1_000 }
        // Spread over 15 to 45 s: no single second holds more than a small share of them.
        assertTrue(seconds.all { it in 15L..45L })
        val busiest = seconds.groupingBy { it }.eachCount().values.maxOrNull()!!
        assertTrue("busiest second had $busiest TVs", busiest <= 12)
        assertTrue("spread over ${seconds.toSet().size} different seconds", seconds.toSet().size >= 20)
    }
}
