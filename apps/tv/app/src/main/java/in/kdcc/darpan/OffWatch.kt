package `in`.kdcc.darpan

/**
 * Notices when the TV itself takes the screen away during display hours (docs/AUDIT.md, DC9): its
 * own sleep or auto power-off timer turning the panel off, or its power-on input setting switching
 * to another input or app. Head office then sees "turned off by the TV, not by Darpan" instead of a
 * TV that looks online but shows nothing. What Darpan does itself (off hours, the screen-off test,
 * a restart, maintenance) is not counted.
 *
 * Times come from [clock] (elapsed time since boot), never the TV's wall clock, which may be wrong;
 * the heartbeat sends "how long ago" and the server turns that into a time.
 */
class OffWatch(private val clock: () -> Long) {
    enum class Kind(val wire: String) { SCREEN("screen"), INPUT("input") }

    private class Event(val kind: Kind, val at: Long, var backAt: Long? = null)

    data class Report(val kind: String, val agoSec: Long, val backAgoSec: Long?, val count: Int)

    /** true in display hours, false outside them, null before the app knows (pairing, starting up). */
    @Volatile var inHours: Boolean? = null

    private var expectedUntil = 0L
    private val events = ArrayDeque<Event>()

    /** Darpan is about to take the screen away itself for up to [ms] (restart, screen-off test). */
    @Synchronized fun expect(ms: Long) {
        expectedUntil = maxOf(expectedUntil, clock() + ms)
    }

    /** The screen went dark or another input/app took it. True when it counts as the TV's doing. */
    @Synchronized fun away(kind: Kind, maintenance: Boolean): Boolean {
        val now = clock()
        if (!countsAsTv(inHours, now < expectedUntil, maintenance)) return false
        if (events.lastOrNull()?.backAt == null && events.isNotEmpty()) return false // still away
        events.addLast(Event(kind, now))
        while (events.size > MAX_EVENTS) events.removeFirst()
        return true
    }

    /** The app is on screen again. True when it closes an open event. */
    @Synchronized fun back(): Boolean {
        val last = events.lastOrNull() ?: return false
        if (last.backAt != null) return false
        last.backAt = clock()
        return true
    }

    /** The latest event and how many in the last day, for the heartbeat. null: none since the app started. */
    @Synchronized fun report(): Report? {
        val now = clock()
        val last = events.lastOrNull() ?: return null
        return Report(
            kind = last.kind.wire,
            agoSec = (now - last.at) / 1000,
            backAgoSec = last.backAt?.let { (now - it) / 1000 },
            count = events.count { now - it.at < DAY_MS },
        )
    }

    companion object {
        private const val MAX_EVENTS = 50
        private const val DAY_MS = 24 * 60 * 60 * 1000L

        /** Only in display hours, and only when Darpan did not cause it. Pure. */
        fun countsAsTv(inHours: Boolean?, darpanExpected: Boolean, maintenance: Boolean): Boolean =
            inHours == true && !darpanExpected && !maintenance
    }
}
