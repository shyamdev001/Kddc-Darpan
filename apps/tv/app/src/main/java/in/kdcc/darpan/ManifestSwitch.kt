package `in`.kdcc.darpan

/**
 * When a new manifest goes on screen (docs/AUDIT.md, OF1): only once every file it needs is on the
 * TV and verified. Until then the TV keeps its current ("active") manifest, so a slow or broken
 * download never leaves a branch with half a campaign or only the default slide.
 *
 * What changes at once anyway, because it needs no download: an ad head office removed or ended
 * early stops; the new display hours, orientation and other settings apply; a broadcast shows.
 * Pure, so the rules are tested on the JVM.
 */
object ManifestSwitch {
    /** Never more than this on an old campaign: after it, the new one goes on with what has arrived. */
    const val GIVE_UP_MS = 3 * 3_600_000L

    sealed class Decision {
        /** Show the new manifest now; it becomes the active one. */
        object Switch : Decision()

        /** Keep showing [play] (the active manifest, minus removed ads, with the new settings) while the rest downloads. */
        data class Wait(val play: Manifest) : Decision()
    }

    fun decide(active: Manifest?, incoming: Manifest, has: (ManifestItem) -> Boolean, waitedMs: Long): Decision {
        if (active == null) return Decision.Switch // the first content ever: something beats nothing
        if (incoming.items.all(has)) return Decision.Switch // nothing new to fetch: a reorder, new dates, settings
        if (waitedMs >= GIVE_UP_MS) return Decision.Switch
        val play = interim(active, incoming, has)
        // Everything the old loop had was removed: the new loop's ready files beat the default slide.
        if (!playsSomething(play, has)) return Decision.Switch
        return Decision.Wait(play)
    }

    /** The active manifest as head office wants it now, without anything that needs a download. */
    fun interim(active: Manifest, incoming: Manifest, has: (ManifestItem) -> Boolean): Manifest {
        val wanted = incoming.items.associateBy { it.mediaId }
        // Ads still wanted, with their new dates: an ad ended early stops now. Removed ads are gone.
        val kept = active.items.mapNotNull { old ->
            wanted[old.mediaId]?.let { new -> old.copy(validFrom = new.validFrom, validUntil = new.validUntil) }
        }.toMutableList()
        val keptIds = kept.map { it.mediaId }.toSet()

        // The new default slide if it is here already, else the old one stays meanwhile.
        val newFallback = incoming.fallbackMediaId?.let { wanted[it] }?.takeIf(has)
        val fallbackId = when {
            newFallback != null -> newFallback.mediaId.also { if (it !in keptIds) kept += newFallback }
            incoming.fallbackMediaId == null -> null
            else -> active.fallbackMediaId?.also { id ->
                if (id !in keptIds) active.items.firstOrNull { it.mediaId == id }?.let { kept += it }
            }
        }

        return active.copy(
            items = kept,
            playlists = active.playlists.map { p -> p.copy(items = p.items.filter { it.mediaId in keptIds }) },
            settings = incoming.settings,
            broadcast = incoming.broadcast,
            app = incoming.app,
            generatedAt = incoming.generatedAt,
            fallbackMediaId = fallbackId,
        )
    }

    /** SHA-256 of every file the TV must keep: the manifest on screen, the one downloading, their broadcasts. */
    fun keep(vararg manifests: Manifest?): Set<String> =
        manifests.filterNotNull().flatMap { m -> listOfNotNull(m.broadcast?.media) + m.items }.map { it.sha256 }.toSet()

    private fun playsSomething(m: Manifest, has: (ManifestItem) -> Boolean): Boolean {
        val byId = m.items.associateBy { it.mediaId }
        if (m.playlists.isEmpty()) return m.items.any(has)
        return m.playlists.any { p -> p.items.any { e -> byId[e.mediaId]?.let(has) == true } }
    }
}
