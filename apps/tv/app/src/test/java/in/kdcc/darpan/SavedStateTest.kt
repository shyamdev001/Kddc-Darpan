package `in`.kdcc.darpan

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** What an older app version saved still reads after an update (docs/AUDIT.md K10). */
@OptIn(ExperimentalSerializationApi::class)
class SavedStateTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private val json = Json { ignoreUnknownKeys = true } // as in Api
    private fun fixture(name: String) = javaClass.getResource("/saved/$name")!!.readText()

    @Test
    fun aManifestSavedBeforeThisVersion_stillReads() {
        val m = json.decodeFromString(Manifest.serializer(), fixture("manifest-before-k10.json"))
        assertEquals(2, m.items.size)
        assertEquals("10:00", m.settings.hours?.on)
        assertNull(m.settings.kioskPin) // added later, defaults to none
        assertFalse(m.app!!.installNow) // added later, defaults to "wait for a quiet time"
    }

    @Test
    fun fieldsFromANewerServer_areIgnored() {
        val m = json.decodeFromString(Manifest.serializer(), fixture("manifest-from-a-newer-server.json"))
        assertEquals("PORTRAIT", m.settings.orientation)
        assertTrue(m.settings.sync)
    }

    @Test
    fun aCrashLogSavedBeforeRescueMode_stillReads() {
        val dir = tmp.newFolder()
        java.io.File(dir, "crashes.json").writeText(fixture("crashes-before-k2.json"))
        val log = CrashLog(dir, versionCode = 1100)
        assertEquals("java.lang.OutOfMemoryError", log.last?.type)
        assertTrue(log.inSafeMode(1_795_400_100_000L))
        assertFalse(log.inRescue(1_795_400_100_000L))
    }

    /**
     * The rule that keeps the two tests above true for the next field too: a field without a default
     * makes every manifest saved by an older version unreadable. Only the fields that were there from
     * the start may be required; a new one must get a default, or this fails.
     */
    @Test
    fun everyFieldAddedLater_hasADefault() {
        val required = mutableSetOf<String>()
        walk(Manifest.serializer().descriptor, mutableSetOf(), required)
        assertEquals(
            setOf(
                "Manifest.version",
                "ManifestItem.mediaId", "ManifestItem.url", "ManifestItem.sha256", "ManifestItem.size", "ManifestItem.type", "ManifestItem.durationSec",
                "ManifestPlaylist.id", "PlaylistEntry.mediaId", "PlaylistEntry.durationSec",
                "DisplayHours.on", "DisplayHours.off",
                "ManifestApp.versionCode", "ManifestApp.versionName", "ManifestApp.url", "ManifestApp.sha256", "ManifestApp.size",
                "ManifestBroadcast.id", "ManifestBroadcast.kind", "BroadcastLink.type",
                "KioskPinHash.salt", "KioskPinHash.hash", "KioskPinHash.iterations",
            ),
            required,
        )
    }

    @Test
    fun upgradeSteps_runOnceForTheBuildsTheyAreFor() {
        val noop: (android.content.Context) -> Unit = {}
        val steps = listOf(AppUpgrade.Step(1200, "b", noop), AppUpgrade.Step(1100, "a", noop))
        assertEquals(listOf("a", "b"), AppUpgrade.due(0, 1300, steps).map { it.name }) // oldest first
        assertEquals(listOf("b"), AppUpgrade.due(1100, 1300, steps).map { it.name })
        assertEquals(emptyList<String>(), AppUpgrade.due(1200, 1300, steps).map { it.name }) // already done
        assertEquals(emptyList<String>(), AppUpgrade.due(1300, 1300, steps).map { it.name }) // same build
        assertEquals(listOf("a"), AppUpgrade.due(1000, 1150, steps).map { it.name }) // not yet b's build
    }

    private fun walk(d: SerialDescriptor, seen: MutableSet<String>, required: MutableSet<String>) {
        val name = d.serialName.removeSuffix("?")
        when (d.kind) {
            StructureKind.CLASS -> if (seen.add(name)) for (i in 0 until d.elementsCount) {
                if (!d.isElementOptional(i)) required += "${name.substringAfterLast('.')}.${d.getElementName(i)}"
                walk(d.getElementDescriptor(i), seen, required)
            }
            StructureKind.LIST, StructureKind.MAP -> for (i in 0 until d.elementsCount) walk(d.getElementDescriptor(i), seen, required)
            else -> Unit
        }
    }
}
