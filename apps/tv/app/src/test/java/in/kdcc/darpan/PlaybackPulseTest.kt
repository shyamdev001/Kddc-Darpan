package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A frozen picture is caught; a long video, a broadcast or the night are not mistaken for one. */
class PlaybackPulseTest {
    private val min = 60_000L

    @Test
    fun noBeatForTenMinutes_isStuck() {
        assertNull(PlaybackPulse.stalled(true, beatAt = 0, busyUntil = 10_000, now = 9 * min))
        assertEquals(11 * min, PlaybackPulse.stalled(true, beatAt = 0, busyUntil = 10_000, now = 11 * min))
    }

    @Test
    fun aLongVideo_isGivenItsOwnLengthFirst() {
        // A 15-minute video started at 0: not stuck at 20 minutes, stuck after 25.
        assertNull(PlaybackPulse.stalled(true, beatAt = 0, busyUntil = 15 * min, now = 20 * min))
        assertEquals(26 * min, PlaybackPulse.stalled(true, beatAt = 0, busyUntil = 15 * min, now = 26 * min))
    }

    @Test
    fun aStoppedPlayer_isNeverStuck() {
        // Held for a broadcast, not paired yet, or closing: the loop is stopped on purpose.
        assertNull(PlaybackPulse.stalled(false, beatAt = 0, busyUntil = 0, now = 120 * min))
    }

    @Test
    fun anOldLoopEnding_doesNotSilenceTheNewOne() {
        val first = PlaybackPulse.start(0)
        val second = PlaybackPulse.start(1_000)
        PlaybackPulse.stop(first) // the old loop's cleanup runs late
        assertEquals(31 * min - 1_000, PlaybackPulse.stalledFor(31 * min))
        PlaybackPulse.stop(second)
        assertNull(PlaybackPulse.stalledFor(31 * min))
    }
}
