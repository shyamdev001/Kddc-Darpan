package `in`.kdcc.darpan

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.OffsetDateTime

/**
 * The schedule edge cases in packages/shared/test-vectors/schedule.json. The server runs the same file
 * against its TypeScript copy of the rules, so the two cannot drift apart.
 */
class ScheduleVectorsTest {
    @Serializable
    private data class Case(
        val name: String,
        val slot: TimeSlot? = null,
        val hours: DisplayHours? = null,
        val at: String,
        val expect: Boolean,
    )

    @Serializable
    private data class Vectors(val cases: List<Case>)

    private fun load(): List<Case> {
        // Gradle runs unit tests from apps/tv/app.
        val file = listOf("../../../packages/shared/test-vectors/schedule.json", "../../packages/shared/test-vectors/schedule.json")
            .map(::File).first { it.exists() }
        return Json { ignoreUnknownKeys = true }.decodeFromString(Vectors.serializer(), file.readText()).cases
    }

    @Test
    fun everyCaseAgreesWithTheServer() {
        val cases = load()
        assertTrue(cases.size >= 20)
        val wrong = cases.filter { c ->
            val at = OffsetDateTime.parse(c.at).toInstant().toEpochMilli()
            val got = if (c.slot != null) Schedule.slotActive(c.slot, at) else Schedule.hoursOn(c.hours, at)
            got != c.expect
        }
        assertEquals("Cases that disagree: ${wrong.joinToString { it.name }}", emptyList<Case>(), wrong)
    }
}
