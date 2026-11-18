package `in`.kdcc.darpan

/**
 * Reads what a TV's video decoders say they support (docs/AUDIT.md, DC4 and DC5). Pure: the numbers
 * are MediaCodecInfo.CodecProfileLevel values, copied here so this runs in plain JVM tests.
 */
object CodecRules {
    data class ProfileLevel(val profile: Int, val level: Int)

    /** What one decoder offers for a format. */
    data class Offer(val levels: List<ProfileLevel>, val landscape1080p30: Boolean, val portrait1080p30: Boolean)

    // ---- H.264 (AVC) ----

    private val AVC_PROFILES = listOf(
        0x10000 to "Constrained Baseline", 1 to "Baseline", 2 to "Main", 4 to "Extended",
        0x80000 to "Constrained High", 8 to "High", 0x10 to "High 10", 0x20 to "High 4:2:2", 0x40 to "High 4:4:4",
    )

    /** High and its supersets decode our files; Constrained High has no B-frames, which x264 uses. */
    private val AVC_HIGH = setOf(8, 0x10, 0x20, 0x40)
    private val AVC_LEVELS = listOf(
        1 to "1", 2 to "1b", 4 to "1.1", 8 to "1.2", 0x10 to "1.3", 0x20 to "2", 0x40 to "2.1", 0x80 to "2.2",
        0x100 to "3", 0x200 to "3.1", 0x400 to "3.2", 0x800 to "4", 0x1000 to "4.1", 0x2000 to "4.2",
        0x4000 to "5", 0x8000 to "5.1", 0x10000 to "5.2", 0x20000 to "6", 0x40000 to "6.1", 0x80000 to "6.2",
    )

    /** The level the server encodes to (H.264 level 4.0). */
    const val AVC_OUR_LEVEL = 0x800

    // ---- H.265 (HEVC) ----

    private val HEVC_PROFILES = listOf(4 to "Main Still", 1 to "Main", 2 to "Main 10", 0x1000 to "Main 10 HDR10", 0x2000 to "Main 10 HDR10+")
    private val HEVC_LEVEL_NAMES = listOf("1", "2", "2.1", "3", "3.1", "4", "4.1", "5", "5.1", "5.2", "6", "6.1", "6.2")

    /** HEVC level bits alternate Main tier and High tier: 1 = Main 1, 2 = High 1, 4 = Main 2... */
    private fun hevcLevelIndex(level: Int): Int = if (level <= 0) -1 else Integer.numberOfTrailingZeros(level) / 2
    private fun hevcLevelName(level: Int): String {
        val bit = Integer.numberOfTrailingZeros(level)
        val name = HEVC_LEVEL_NAMES.getOrNull(bit / 2) ?: return "unknown"
        return if (bit % 2 == 0) name else "$name High tier"
    }

    /** The best H.264 any decoder offers, and whether it plays the server's files: High at 4.0, 1080p30. */
    fun avc(offers: List<Offer>): CodecSupport? {
        if (offers.isEmpty()) return null
        val all = offers.flatMap { it.levels }
        val best = all.maxWithOrNull(compareBy<ProfileLevel>({ rank(AVC_PROFILES, it.profile) }, { it.level }))
        val ours = offers.any { o -> o.landscape1080p30 && (o.levels.isEmpty() || o.levels.any { it.profile in AVC_HIGH && it.level >= AVC_OUR_LEVEL }) }
        val portrait = offers.any { o -> o.portrait1080p30 && (o.levels.isEmpty() || o.levels.any { it.profile in AVC_HIGH && it.level >= AVC_OUR_LEVEL }) }
        return CodecSupport(
            profile = best?.let { name(AVC_PROFILES, it.profile) } ?: "not reported",
            level = best?.let { name(AVC_LEVELS, it.level) } ?: "not reported",
            ours = ours,
            portrait = portrait,
        )
    }

    /** The best H.265 any decoder offers; "ours" means Main at level 4 or more, 1080p30 (for the record). */
    fun hevc(offers: List<Offer>): CodecSupport? {
        if (offers.isEmpty()) return null
        val all = offers.flatMap { it.levels }
        val best = all.maxWithOrNull(compareBy<ProfileLevel>({ rank(HEVC_PROFILES, it.profile) }, { hevcLevelIndex(it.level) }))
        val main = { p: ProfileLevel -> p.profile in setOf(1, 2, 0x1000, 0x2000) && hevcLevelIndex(p.level) >= 5 }
        return CodecSupport(
            profile = best?.let { name(HEVC_PROFILES, it.profile) } ?: "not reported",
            level = best?.let { hevcLevelName(it.level) } ?: "not reported",
            ours = offers.any { o -> o.landscape1080p30 && (o.levels.isEmpty() || o.levels.any(main)) },
            portrait = offers.any { o -> o.portrait1080p30 && (o.levels.isEmpty() || o.levels.any(main)) },
        )
    }

    /**
     * Hardware or software decoder. Android 10+ says so itself ([reported]); before that, Android's own
     * software decoders are known by name and everything else is the chip vendor's (hardware).
     */
    fun isHardware(name: String, reported: Boolean?): Boolean =
        reported ?: !(name.startsWith("OMX.google.", ignoreCase = true) || name.startsWith("c2.android.", ignoreCase = true))

    /** Google TV, Android TV (with Google services) or plain Android without them. */
    fun platform(leanback: Boolean, googleTvLauncher: Boolean, playServices: Boolean): String = when {
        leanback && googleTvLauncher -> "googletv"
        leanback && playServices -> "androidtv"
        else -> "aosp"
    }

    private fun rank(table: List<Pair<Int, String>>, value: Int): Int = table.indexOfFirst { it.first == value }
    private fun name(table: List<Pair<Int, String>>, value: Int): String = table.firstOrNull { it.first == value }?.second ?: "unknown ($value)"
}
