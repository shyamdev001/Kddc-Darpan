package `in`.kdcc.darpan

import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * The last manifest received, so the TV keeps playing after a reboot with no network.
 *
 * Branch power cuts are common, so a save must never leave the TV with nothing:
 * - the new copy is written to a temporary file and flushed to the disk (fsync) before it replaces
 *   the old one, in a single rename;
 * - the previous good copy is kept as `manifest.json.bak`;
 * - loading checks the saved text (`isValid`, e.g. "it parses") and falls back to the backup.
 */
class ManifestStore(dir: File, name: String = "manifest.json", private val isValid: (String) -> Boolean = { true }) {
    private val file = File(dir, name)
    private val backup = File(dir, "$name.bak")

    @Throws(IOException::class)
    fun save(raw: String) {
        // Keep the current good copy as the backup first (also written safely).
        val current = read(file)
        if (current != null && current != raw && isValid(current)) writeSafely(backup, current)
        writeSafely(file, raw)
    }

    /** The saved manifest, or the backup if the main copy is missing or damaged. Null if neither is usable. */
    fun load(): String? = read(file)?.takeIf(isValid) ?: read(backup)?.takeIf(isValid)

    fun clear() {
        file.delete()
        backup.delete()
        File(file.path + ".tmp").delete()
        File(backup.path + ".tmp").delete()
    }

    private fun read(f: File): String? = try {
        if (f.exists()) f.readText(Charsets.UTF_8).takeIf { it.isNotBlank() } else null
    } catch (e: IOException) {
        null
    }

    private fun writeSafely(target: File, text: String) {
        val tmp = File(target.path + ".tmp")
        FileOutputStream(tmp).use { out ->
            out.write(text.toByteArray(Charsets.UTF_8))
            out.flush()
            out.fd.sync() // on the disk, not just in a cache, before it takes the real name
        }
        // On Android (Linux) a rename replaces the old file in one step: there is always a whole file.
        if (!tmp.renameTo(target)) {
            tmp.delete()
            throw IOException("Could not save ${target.name}")
        }
    }
}
