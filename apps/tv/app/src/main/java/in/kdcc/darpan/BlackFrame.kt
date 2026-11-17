package `in`.kdcc.darpan

/**
 * Window screenshots often leave out the video: ExoPlayer draws on its own surface, which many TVs
 * do not include in a window copy, so the video area comes out black. This tells such a capture
 * apart from a real picture. Pure, so it is tested without a TV.
 */
object BlackFrame {
    /** Darker than this (0-255 luma) counts as black: allows for JPEG noise and the TV's black level. */
    private const val DARK = 20
    /** This share of the samples must be dark. A real video frame is almost never this uniform. */
    private const val SHARE = 0.98

    fun isBlack(argb: IntArray): Boolean {
        if (argb.isEmpty()) return false
        val dark = argb.count { luma(it) < DARK }
        return dark >= argb.size * SHARE
    }

    private fun luma(c: Int): Int {
        val r = (c shr 16) and 0xff
        val g = (c shr 8) and 0xff
        val b = c and 0xff
        return (r * 299 + g * 587 + b * 114) / 1000
    }

    /**
     * What a video capture teaches us. A visible picture proves video can be captured, for good.
     * A black one only counts while that was never seen: a dark scene must not undo a proof.
     */
    fun learned(previous: Boolean?, black: Boolean): Boolean = if (black) previous == true else true
}
