package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The local unlock (K1): Menu five times, then head office's PIN; never the PIN itself on the TV. */
class KioskPinTest {
    // PBKDF2-HMAC-SHA1("482916", salt, 1000, 32 bytes), worked out with Python's hashlib, the same
    // function the server uses (Node crypto.pbkdf2).
    private val hash = KioskPinHash(
        salt = "00112233445566778899aabbccddeeff",
        hash = "91cc3f382c2660c4e46cd8f9bc453033a547a39a7953df61554f91d06afd49a7",
        iterations = 1000,
    )

    @Test
    fun theRightPin_matches_aWrongOneDoesNot() {
        assertTrue(KioskPin.matches("482916", hash))
        assertFalse(KioskPin.matches("482917", hash))
        assertFalse(KioskPin.matches("", hash))
        assertFalse(KioskPin.matches("48291a", hash))
    }

    @Test
    fun aDamagedHash_neverMatches() {
        assertFalse(KioskPin.matches("482916", hash.copy(salt = "xyz")))
        assertFalse(KioskPin.matches("482916", hash.copy(hash = "")))
        assertFalse(KioskPin.matches("482916", hash.copy(iterations = 0)))
        assertFalse(KioskPin.matches("482916", hash.copy(iterations = 10_000_000))) // would hang the TV
    }

    @Test
    fun fiveWrongPins_blockForFifteenMinutes() {
        val t0 = 1_800_000_000_000L
        var g = KioskPin.Gate()
        repeat(4) {
            val (next, blocked) = KioskPin.wrong(g, t0)
            assertFalse(blocked)
            g = next
        }
        assertEquals(0L, KioskPin.blockedFor(g, t0))
        val (fifth, blocked) = KioskPin.wrong(g, t0)
        assertTrue(blocked)
        assertEquals(KioskPin.BLOCK_MS, KioskPin.blockedFor(fifth, t0))
        assertEquals(60_000L, KioskPin.blockedFor(fifth, t0 + KioskPin.BLOCK_MS - 60_000))
        assertEquals(0L, KioskPin.blockedFor(fifth, t0 + KioskPin.BLOCK_MS))
        assertEquals(0, fifth.failures) // the next five tries start a new count
    }

    @Test
    fun aClockSetBack_cannotStretchTheBlock() {
        val t0 = 1_800_000_000_000L
        val (g, _) = KioskPin.wrong(KioskPin.Gate(failures = 4), t0)
        assertEquals(KioskPin.BLOCK_MS, KioskPin.blockedFor(g, t0 - 3 * 86_400_000L))
    }

    @Test
    fun menuFiveTimesWithinThreeSeconds_opensThePinBox() {
        val p = KioskPin.Presses()
        assertFalse(p.press(0))
        assertFalse(p.press(500))
        assertFalse(p.press(1_000))
        assertFalse(p.press(1_500))
        assertTrue(p.press(2_000))
        assertEquals(0, p.count) // starts over
    }

    @Test
    fun slowPresses_doNot() {
        val p = KioskPin.Presses()
        for (i in 0 until 10) assertFalse(p.press(i * 1_000L))
    }

    @Test
    fun eventsOlderThanADay_areDropped() {
        val now = 1_800_000_000_000L
        val events = listOf(
            KioskPin.Event("a", "pinFailed", now - 25 * 3_600_000L),
            KioskPin.Event("b", "pinUnlock", now - 3_600_000L),
            KioskPin.Event("c", "pinFailed", now + 3_600_000L), // clock far ahead when recorded
        )
        assertEquals(listOf("b"), KioskPin.keep(events, now).map { it.id })
    }
}
