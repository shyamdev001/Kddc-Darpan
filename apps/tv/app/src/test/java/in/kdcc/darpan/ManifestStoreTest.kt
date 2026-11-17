package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** A power cut at any moment must leave a manifest the TV can play. */
class ManifestStoreTest {
    @get:Rule
    val tmp = TemporaryFolder()

    // Stands in for "the JSON parses": a whole manifest ends with a closing brace.
    private fun store() = ManifestStore(tmp.root) { it.trim().startsWith("{") && it.trim().endsWith("}") }

    private val v1 = """{"version":"1"}"""
    private val v2 = """{"version":"2"}"""

    @Test
    fun savesAndLoads() {
        val s = store()
        s.save(v1)
        assertEquals(v1, s.load())
        s.save(v2)
        assertEquals(v2, s.load())
    }

    @Test
    fun mainFileMissingAfterCrash_loadsThePreviousGoodCopy() {
        val s = store()
        s.save(v1)
        s.save(v2)
        File(tmp.root, "manifest.json").delete()
        assertEquals(v1, s.load())
    }

    @Test
    fun mainFileCutShort_loadsThePreviousGoodCopy() {
        val s = store()
        s.save(v1)
        s.save(v2)
        File(tmp.root, "manifest.json").writeText("""{"version":"2","ite""")
        assertEquals(v1, s.load())
    }

    @Test
    fun emptyMainFile_loadsThePreviousGoodCopy() {
        val s = store()
        s.save(v1)
        s.save(v2)
        File(tmp.root, "manifest.json").writeText("")
        assertEquals(v1, s.load())
    }

    @Test
    fun leftoverTempFileFromACrash_doesNotDisturbLoading() {
        val s = store()
        s.save(v1)
        File(tmp.root, "manifest.json.tmp").writeText("""{"version":"half""")
        assertEquals(v1, s.load())
        s.save(v2)
        assertEquals(v2, s.load())
    }

    @Test
    fun aDamagedCopyNeverBecomesTheBackup() {
        val s = store()
        s.save(v1)
        s.save(v2) // backup: v1
        File(tmp.root, "manifest.json").writeText("""{"bro""")
        s.save("""{"version":"3"}""") // the damaged main copy must not replace the good backup
        File(tmp.root, "manifest.json").delete()
        assertEquals(v1, s.load())
    }

    @Test
    fun nothingSaved_or_cleared_loadsNothing() {
        val s = store()
        assertNull(s.load())
        s.save(v1)
        s.clear()
        assertNull(s.load())
    }
}
