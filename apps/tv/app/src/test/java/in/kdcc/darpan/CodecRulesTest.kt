package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Plays our videos" means High at level 4.0 and 1080p at 30 fps, not just the size (DC4, DC5). */
class CodecRulesTest {
    private val high = 8
    private val main = 2
    private val baseline = 1
    private val level31 = 0x200
    private val level40 = 0x800
    private val level51 = 0x8000

    private fun offer(vararg levels: Pair<Int, Int>, landscape: Boolean = true, portrait: Boolean = true) =
        CodecRules.Offer(levels.map { CodecRules.ProfileLevel(it.first, it.second) }, landscape, portrait)

    @Test
    fun aHighProfileDecoderAtLevel4OrMore_playsOurFiles() {
        val s = CodecRules.avc(listOf(offer(baseline to level51, main to level51, high to level51)))!!
        assertEquals("High", s.profile)
        assertEquals("5.1", s.level)
        assertTrue(s.ours)
        assertTrue(s.portrait)
        assertTrue(CodecRules.avc(listOf(offer(high to level40)))!!.ours)
    }

    @Test
    fun mainOnly_orALowLevel_orNot1080p30_doesNot() {
        assertFalse("Main profile only", CodecRules.avc(listOf(offer(main to level51)))!!.ours)
        assertFalse("High at 3.1 is 720p", CodecRules.avc(listOf(offer(high to level31)))!!.ours)
        assertFalse("size or rate refused", CodecRules.avc(listOf(offer(high to level51, landscape = false)))!!.ours)
        val noPortrait = CodecRules.avc(listOf(offer(high to level51, portrait = false)))!!
        assertTrue(noPortrait.ours)
        assertFalse(noPortrait.portrait)
    }

    @Test
    fun oneGoodDecoderAmongSeveral_isEnough() {
        val s = CodecRules.avc(listOf(offer(main to level31), offer(high to level40, landscape = true)))!!
        assertTrue(s.ours)
        assertEquals("High", s.profile)
        assertEquals("4", s.level)
    }

    @Test
    fun noDecoder_isNull_andNoLevelList_trustsTheSizeCheck() {
        assertNull(CodecRules.avc(emptyList()))
        val s = CodecRules.avc(listOf(offer()))!!
        assertTrue(s.ours)
        assertEquals("not reported", s.profile)
    }

    @Test
    fun hevcLevelBits_alternateMainAndHighTier() {
        // Main tier 4.1 = 0x1000 (index 6), High tier 5.1 = 0x20000 (index 8).
        val s = CodecRules.hevc(listOf(offer(1 to 0x1000, 2 to 0x20000)))!!
        assertEquals("Main 10", s.profile)
        assertEquals("5.1 High tier", s.level)
        assertTrue(s.ours)
        assertFalse(CodecRules.hevc(listOf(offer(1 to 0x40)))!!.ours) // Main 3: below 1080p
    }

    @Test
    fun androidsOwnDecoders_areSoftware() {
        assertFalse(CodecRules.isHardware("OMX.google.h264.decoder", null))
        assertFalse(CodecRules.isHardware("c2.android.avc.decoder", null))
        assertTrue(CodecRules.isHardware("OMX.MTK.VIDEO.DECODER.AVC", null))
        assertFalse("Android 10+ says so itself", CodecRules.isHardware("c2.mtk.avc.decoder", false))
    }

    @Test
    fun platform_googleTv_androidTv_orPlainAndroid() {
        assertEquals("googletv", CodecRules.platform(leanback = true, googleTvLauncher = true, playServices = true))
        assertEquals("androidtv", CodecRules.platform(leanback = true, googleTvLauncher = false, playServices = true))
        assertEquals("aosp", CodecRules.platform(leanback = true, googleTvLauncher = false, playServices = false))
        assertEquals("aosp", CodecRules.platform(leanback = false, googleTvLauncher = false, playServices = true))
    }
}
