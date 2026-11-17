package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId

/** The maths that keeps screens in step: same inputs, same answer, on every TV. */
class TimelineTest {
    private val steps = listOf(
        Timeline.Step("a", 10_000),
        Timeline.Step("b", 5_000),
        Timeline.Step("c", 15_000),
    ) // loop: 30 s

    private fun ist(s: String): Long = LocalDateTime.parse(s).atZone(ZoneId.of("Asia/Kolkata")).toInstant().toEpochMilli()

    @Test
    fun findsTheItemAndHowFarIntoIt() {
        val p = Timeline.at(steps, anchorMs = 0, nowMs = 12_500)!!
        assertEquals(1, p.index)
        assertEquals(2_500, p.offsetMs)
        assertEquals(10_000, p.startedAt)
        assertEquals(15_000, p.endsAt)
        assertEquals(30_000, p.loopMs)
    }

    @Test
    fun switchesExactlyOnTheBoundary() {
        assertEquals(0, Timeline.at(steps, 0, 9_999)!!.index)
        val p = Timeline.at(steps, 0, 10_000)!!
        assertEquals(1, p.index)
        assertEquals(0, p.offsetMs)
        assertEquals(0, Timeline.at(steps, 0, 30_000)!!.index) // loops round
    }

    @Test
    fun twoTvsAgree_whenEverAndHoweverLongTheyHaveRun() {
        // Same server time, same playlist: same answer, whatever each TV did before.
        val now = ist("2026-11-17T11:23:45.678")
        assertEquals(Timeline.at(steps, 0, now), Timeline.at(steps.toList(), 0, now))
        // A long way into the loop: still exact, no drift from adding up.
        val p = Timeline.at(steps, 0, 30_000L * 1_000_000 + 12_000)!!
        assertEquals(1, p.index)
        assertEquals(2_000, p.offsetMs)
    }

    @Test
    fun aMomentBeforeTheAnchorStillLandsInTheLoop() {
        val p = Timeline.at(steps, anchorMs = 100_000, nowMs = 100_000 - 1_000)!!
        assertEquals(2, p.index) // the last second of the loop
        assertEquals(14_000, p.offsetMs)
    }

    @Test
    fun aZeroLengthItemCannotSpinTheLoop() {
        val p = Timeline.at(listOf(Timeline.Step("a", 0), Timeline.Step("b", 0)), 0, 1_500)!!
        assertEquals(1, p.index)
        assertEquals(2_000, p.loopMs)
        assertNull(Timeline.at(emptyList(), 0, 1_000))
    }

    @Test
    fun anAdEndingMidLoop_isTheNextChangeForEveryone() {
        val now = ist("2026-11-30T23:59:00")
        val end = ist("2026-11-30T23:59:59")
        val start = ist("2026-12-01T00:00")
        assertEquals(end, Timeline.nextChange(listOf(null, start, end, now - 1), now))
        assertNull(Timeline.nextChange(listOf(null, now - 1), now))
    }

    @Test
    fun aVideoFarOff_isSought_butNotTwiceInARow() {
        assertEquals(Timeline.Correction.Seek(5_150), Timeline.correction(driftMs = -800, wantMs = 5_000, msSinceLastSeek = 10_000))
        // Just sought: nudge instead, so the picture does not stutter.
        assertEquals(Timeline.Correction.Speed(1.02f), Timeline.correction(-800, 5_000, msSinceLastSeek = 500))
    }

    @Test
    fun aVideoSlightlyOff_isNudged_andOnTime_isLeftAlone() {
        assertEquals(Timeline.Correction.Speed(0.98f), Timeline.correction(driftMs = 200, wantMs = 0, msSinceLastSeek = 0))
        assertEquals(Timeline.Correction.Speed(1.02f), Timeline.correction(driftMs = -41, wantMs = 0, msSinceLastSeek = 0))
        assertEquals(Timeline.Correction.Speed(1f), Timeline.correction(driftMs = 40, wantMs = 0, msSinceLastSeek = 0))
        assertEquals(Timeline.Correction.Speed(0.98f), Timeline.correction(driftMs = 500, wantMs = 0, msSinceLastSeek = 99_999))
    }

    @Test
    fun theClock_takesTheMedianOfTheQuickAnswers() {
        val e = OffsetEstimator()
        assertNull(e.offset())
        // True offset 1_000_000. Quick answers (RTT 20-30 ms) land within a few ms of it.
        e.add(serverMs = 1_000_000 + 1_010, sentAt = 1_000, receivedAt = 1_020) // RTT 20, offset 1_000_000
        e.add(1_000_000 + 2_012, 2_000, 2_024) // RTT 24, offset 1_000_000
        e.add(1_000_000 + 3_018, 3_000, 3_030) // RTT 30, offset 1_000_003
        // A slow answer with a lopsided delay would pull the clock 400 ms: it is left out.
        e.add(1_000_000 + 4_000 + 900, 4_000, 5_000) // RTT 1000
        assertEquals(1_000_000L, e.offset())
        assertEquals(10L, e.errorMs())
        assertEquals(4, e.count())
    }

    @Test
    fun theClock_ignoresNonsenseAndForgetsOldAnswers() {
        val e = OffsetEstimator(keep = 16, maxAgeMs = 60_000)
        e.add(serverMs = 0, sentAt = 0, receivedAt = 10) // no server time
        e.add(5_000, sentAt = 100, receivedAt = 50) // answer before the question
        e.add(5_000, sentAt = 0, receivedAt = 5_000) // took 5 s
        assertNull(e.offset())
        e.add(500_010, 0, 20) // offset 500_000
        e.add(700_010 + 120_000, 120_000, 120_020) // offset 700_000, two minutes later
        assertEquals(1, e.count())
        assertEquals(700_000L, e.offset())
    }

    @Test
    fun theClock_keepsOnlyTheLatestAnswers() {
        val e = OffsetEstimator(keep = 3)
        for (i in 0 until 10) e.add(serverMs = 1_000L + i * 100 + 10, sentAt = i * 100L, receivedAt = i * 100L + 20)
        assertEquals(3, e.count())
    }

    @Test
    fun aTimedPlaylist_isAnchoredWhereItsSlotOpened() {
        val morning = TimeSlot(start = "10:00", end = "12:00")
        assertEquals(ist("2026-11-17T10:00"), Schedule.windowStart(listOf(morning), ist("2026-11-17T11:30")))
        assertNull(Schedule.windowStart(listOf(morning), ist("2026-11-17T12:00")))
        // Past midnight: the early hours belong to the evening before.
        val night = TimeSlot(start = "22:00", end = "02:00")
        assertEquals(ist("2026-11-16T22:00"), Schedule.windowStart(listOf(night), ist("2026-11-17T01:15")))
        assertEquals(ist("2026-11-17T22:00"), Schedule.windowStart(listOf(night), ist("2026-11-17T23:00")))
        // A whole-day slot opens at midnight India time.
        assertEquals(ist("2026-11-17T00:00"), Schedule.windowStart(listOf(TimeSlot()), ist("2026-11-17T15:00")))
        // So the first item comes on as the slot opens, on every screen.
        val anchor = Schedule.windowStart(listOf(morning), ist("2026-11-17T10:00"))!!
        val p = Timeline.at(steps, anchor, ist("2026-11-17T10:00"))!!
        assertEquals(0, p.index)
        assertEquals(0, p.offsetMs)
        assertEquals(anchor + 10_000, p.endsAt)
    }
}
