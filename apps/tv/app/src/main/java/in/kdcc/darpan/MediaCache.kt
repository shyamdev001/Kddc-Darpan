package `in`.kdcc.darpan

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest

/**
 * Media files on the TV, named by their SHA-256. A file only gets its final name after its
 * checksum matches the manifest, so anything the player finds here has been verified.
 */
class MediaCache(filesDir: File, private val http: OkHttpClient, private val prefs: Prefs) {
    val dir: File = File(filesDir, "media").apply { mkdirs() }

    fun fileFor(item: ManifestItem): File = File(dir, item.sha256 + if (item.isVideo) ".mp4" else ".img")

    fun has(item: ManifestItem): Boolean {
        val f = fileFor(item)
        return f.exists() && f.length() == item.size
    }

    /**
     * Downloads one item, resuming a partial download if there is one. Returns true when the
     * verified file is in place, false when the checksum did not match (the file is discarded).
     * Blocking: call from a background thread.
     */
    @Throws(IOException::class)
    fun download(item: ManifestItem): Boolean {
        if (has(item)) return true
        if (dir.usableSpace < item.size + RESERVE_BYTES) {
            Log.w(TAG, "Not enough space for ${item.mediaId} (${item.size} bytes)")
            return false
        }
        val part = File(dir, item.sha256 + ".part")
        var have = if (part.exists()) part.length() else 0L
        if (have >= item.size) {
            part.delete()
            have = 0L
        }

        val builder = Request.Builder().url(item.url).header("Authorization", "Bearer ${prefs.deviceToken ?: ""}")
        if (have > 0) builder.header("Range", "bytes=$have-")
        http.newCall(builder.build()).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, "Download failed for ${item.mediaId}")
            val append = have > 0 && res.code == 206 // server honoured the Range header
            val body = res.body ?: throw IOException("Empty response for ${item.mediaId}")
            FileOutputStream(part, append).use { out -> body.byteStream().use { it.copyTo(out, 64 * 1024) } }
        }

        if (part.length() != item.size || sha256(part) != item.sha256) {
            Log.w(TAG, "Checksum mismatch for ${item.mediaId}; discarding")
            part.delete()
            return false
        }
        val target = fileFor(item)
        if (!part.renameTo(target)) {
            part.delete()
            throw IOException("Could not move ${part.name} into place")
        }
        return true
    }

    /** Deletes a file that turned out to be unplayable, so the next sync downloads it again. */
    fun discard(item: ManifestItem) {
        fileFor(item).delete()
    }

    /** Removes files no manifest item refers to (including stale partial downloads). */
    fun cleanup(keepSha256: Set<String>) {
        dir.listFiles()?.forEach { f ->
            if (f.name.substringBefore('.') !in keepSha256) f.delete()
        }
    }

    fun clearAll() {
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private companion object {
        const val TAG = "MediaCache"
        const val RESERVE_BYTES = 200L * 1024 * 1024 // keep some room for the system
    }
}

/** The last manifest received, so the TV keeps playing after a reboot with no network. */
class ManifestStore(filesDir: File) {
    private val file = File(filesDir, "manifest.json")

    fun save(raw: String) {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(raw)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    fun load(): String? = if (file.exists()) file.readText() else null

    fun clear() {
        file.delete()
    }
}
