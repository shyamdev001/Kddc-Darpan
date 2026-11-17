package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Screen-off counts as working only when the TV also comes back on by itself. */
class ScreenOffTest {
    @Test
    fun offAndBackOn_works() {
        val r = ScreenOffResult(wentOff = true, cameBack = true)
        assertTrue(r.works)
        assertNull(r.problem)
    }

    @Test
    fun ignored_saysToUseTheTvTimer() {
        val r = ScreenOffResult(wentOff = false, cameBack = true)
        assertFalse(r.works)
        assertEquals(true, r.problem?.contains("own on/off timer"))
    }

    @Test
    fun offButNotBack_isTheDangerousCase_andIsNotUsed() {
        val r = ScreenOffResult(wentOff = true, cameBack = false)
        assertFalse(r.works)
        assertEquals(true, r.problem?.contains("did not come back"))
    }
}
