package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A screenshot that missed the video is recognised, so head office is told instead of worrying. */
class BlackFrameTest {
    private fun rgb(r: Int, g: Int, b: Int) = (0xff shl 24) or (r shl 16) or (g shl 8) or b

    @Test
    fun aMissingVideoSurface_isBlack() {
        assertTrue(BlackFrame.isBlack(IntArray(576) { rgb(0, 0, 0) }))
        // JPEG noise and a TV's raised black level still count.
        assertTrue(BlackFrame.isBlack(IntArray(576) { rgb(12, 14, 10) }))
    }

    @Test
    fun aRealPicture_isNot() {
        // A dark night-time ad with a bright logo in one corner.
        val frame = IntArray(576) { i -> if (i % 32 < 4 && i / 32 < 3) rgb(250, 200, 40) else rgb(8, 8, 30) }
        assertFalse(BlackFrame.isBlack(frame))
        assertFalse(BlackFrame.isBlack(IntArray(576) { rgb(200, 30, 30) }))
        assertFalse(BlackFrame.isBlack(IntArray(0)))
    }

    @Test
    fun oneVisibleVideo_provesCapture_andADarkSceneDoesNotUndoIt() {
        assertEquals(false, BlackFrame.learned(null, black = true))
        assertEquals(true, BlackFrame.learned(false, black = false))
        assertEquals(true, BlackFrame.learned(true, black = true))
        assertEquals(true, BlackFrame.learned(null, black = false))
    }
}
