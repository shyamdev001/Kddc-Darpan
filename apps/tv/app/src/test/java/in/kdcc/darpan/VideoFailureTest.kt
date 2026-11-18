package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/** A video the TV cannot decode is skipped and reported, never downloaded again and again (DC3). */
class VideoFailureTest {
    @Test
    fun theDecoderRefusing_isTheTv_soItIsSkippedAtOnce() {
        for (code in listOf(4001, 4002, 4003, 4004, 4005, 5001)) {
            val a = VideoFailure.decide(code, redownloadsSoFar = 0)
            assertEquals(code.toString(), VideoFailure.Action.Skip(VideoFailure.reason(code)), a)
        }
        assertEquals("this TV cannot decode this video format", VideoFailure.reason(4005))
    }

    @Test
    fun aFileThatCouldNotBeRead_isDownloadedAgainOnce_thenSkipped() {
        assertSame(VideoFailure.Action.Redownload, VideoFailure.decide(2000, 0))
        assertSame(VideoFailure.Action.Redownload, VideoFailure.decide(3001, 0))
        assertSame(VideoFailure.Action.Redownload, VideoFailure.decide(null, 0))
        assertEquals(
            VideoFailure.Action.Skip("still fails after downloading it again: the file looks damaged"),
            VideoFailure.decide(3001, VideoFailure.MAX_REDOWNLOADS),
        )
    }

    @Test
    fun unknownCodes_stillGetPlainWords() {
        assertEquals("the TV's video decoder failed", VideoFailure.reason(4999))
        assertEquals("playback error 1003", VideoFailure.reason(1003))
    }
}
