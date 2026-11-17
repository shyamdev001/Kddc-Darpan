package `in`.kdcc.darpan

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * What a branch kept in step plays right now (docs: SYNC_DESIGN.md, section 3).
 *
 * Built from the manifest and the server's time only, never from what this TV has downloaded, so
 * every screen in the branch gets the same loop. A file this TV is missing keeps its slot on the
 * timeline (the default slide fills it); it is not skipped, or this TV would run ahead of the rest.
 */
object SyncPlan {
    class Plan(
        /** Changes whenever the loop itself changes (another playlist, an ad in or out of its dates). */
        val key: String,
        val steps: List<Timeline.Step>,
        /** The manifest item for each step. */
        val items: List<ManifestItem>,
        val anchorMs: Long,
        /** When an ad next starts or stops being in its dates: the loop is worked out again then. */
        val changesAt: Long?,
    )

    fun at(m: Manifest, nowMs: Long, clockCertain: Boolean): Plan? {
        val byId = m.items.associateBy { it.mediaId }
        // An ad is in its dates from validFrom to validUntil inclusive, so it drops out a ms after.
        val bounds = m.items.flatMap { listOf(time(it.validFrom), time(it.validUntil)?.plus(1)) }
        val changesAt = Timeline.nextChange(bounds, nowMs)
        val lists = m.playlists.ifEmpty {
            // manifest from an older server: one list, in order
            listOf(ManifestPlaylist(id = "items", items = m.items.map { PlaylistEntry(it.mediaId, it.durationSec) }))
        }
        for (p in lists) {
            // Unsure what time it is: only the always-on layer, never a time slot that may be wrong.
            if (!clockCertain && p.slots.isNotEmpty()) continue
            if (!Schedule.slotsActive(p.slots, nowMs)) continue
            val entries = p.items.mapNotNull { e -> byId[e.mediaId]?.takeIf { inDates(it, nowMs) }?.let { it to e.durationSec } }
            if (entries.isEmpty()) continue
            // A timed playlist starts from its first item when its slot opens; the always-on one runs
            // from a fixed point, so a TV switched on later joins the others mid-loop.
            val anchor = if (p.slots.isEmpty()) 0L else Schedule.windowStart(p.slots, nowMs) ?: 0L
            val steps = entries.map { (item, sec) -> Timeline.Step(item.mediaId, sec * 1000L) }
            val key = p.id + "@" + anchor + ":" + steps.joinToString(",") { "${it.mediaId}/${it.durationMs}" }
            return Plan(key, steps, entries.map { it.first }, anchor, changesAt)
        }
        return null
    }

    fun inDates(item: ManifestItem, nowMs: Long): Boolean {
        val from = time(item.validFrom)
        val until = time(item.validUntil)
        return (from == null || nowMs >= from) && (until == null || nowMs <= until)
    }

    /** Time slots start and end on whole minutes, the same instant on every screen. */
    fun nextMinute(nowMs: Long): Long = (Math.floorDiv(nowMs, 60_000L) + 1) * 60_000L

    private fun time(s: String?): Long? = if (s == null) null else try {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(s)?.time
    } catch (e: Exception) {
        null
    }
}
