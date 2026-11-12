package `in`.kdcc.darpan

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import kotlin.random.Random

/**
 * App updates (OTA). When the manifest offers a newer build, download it (resumable), check its
 * SHA-256, and install it silently, which Android allows only for the device owner (kiosk mode).
 * The install replaces this app and restarts it; BootReceiver opens it again.
 */
class Updater(
    private val context: Context,
    private val http: OkHttpClient,
    private val prefs: Prefs,
    /** Called when the status line changes, so the heartbeat can tell the dashboard. */
    private val onStatus: () -> Unit,
) {
    private val busy = Mutex()
    private val apk = File(context.filesDir, "update.apk")
    private val part = File(context.filesDir, "update.apk.part")

    /** Last word on an update for the dashboard, or null when there is nothing to report. */
    val status: String? get() = store(context).getString(KEY_STATUS, null)

    /** Call after each manifest; does nothing if no newer build is offered or one is already on its way. */
    suspend fun consider(app: ManifestApp?) {
        if (app == null || app.versionCode <= BuildConfig.VERSION_CODE) {
            if (status != null) setStatus(null)
            withContext(Dispatchers.IO) {
                apk.delete()
                part.delete()
            }
            return
        }
        if (!Kiosk.isOwner(context)) {
            setStatus("Version ${app.versionName} is available; this TV is not in kiosk mode, so install it by hand")
            return
        }
        val s = store(context)
        if (s.getInt(KEY_FAILED_CODE, 0) == app.versionCode && System.currentTimeMillis() - s.getLong(KEY_FAILED_AT, 0) < RETRY_AFTER_MS) return
        if (!busy.tryLock()) return
        try {
            // A hundred TVs told at the same moment should not all download at once.
            val waitMs = Random.nextLong(0, SPREAD_MS)
            setStatus("Version ${app.versionName} will download in ${waitMs / 60_000 + 1} min")
            delay(waitMs)
            setStatus("Downloading version ${app.versionName}")
            withContext(Dispatchers.IO) { download(app) }
            setStatus("Installing version ${app.versionName}")
            withContext(Dispatchers.IO) { install(app) }
            // Android now replaces the app and this process ends. A failure arrives in UpdateReceiver.
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Update to ${app.versionName} failed", e)
            recordFailure(context, app.versionCode, "Version ${app.versionName} failed: ${e.message ?: e.javaClass.simpleName}")
            onStatus()
        } finally {
            busy.unlock()
        }
    }

    private fun download(app: ManifestApp) {
        if (apk.exists() && apk.length() == app.size && sha256(apk) == app.sha256) return
        apk.delete()
        if (context.filesDir.usableSpace < app.size * 3) throw IOException("not enough free space")
        var have = if (part.exists()) part.length() else 0L
        if (have >= app.size) {
            part.delete()
            have = 0L
        }
        val req = Request.Builder().url(app.url).header("Authorization", "Bearer ${prefs.deviceToken ?: ""}")
        if (have > 0) req.header("Range", "bytes=$have-")
        http.newCall(req.build()).execute().use { res ->
            if (!res.isSuccessful) throw IOException("download refused (${res.code})")
            val append = have > 0 && res.code == 206
            val body = res.body ?: throw IOException("empty download")
            FileOutputStream(part, append).use { out -> body.byteStream().use { it.copyTo(out, 64 * 1024) } }
        }
        if (part.length() != app.size || sha256(part) != app.sha256) {
            part.delete()
            throw IOException("the download did not match its checksum")
        }
        if (!part.renameTo(apk)) throw IOException("could not save the download")
    }

    private fun install(app: ManifestApp) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("darpan.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out, 64 * 1024) }
                session.fsync(out)
            }
            val intent = Intent(context, UpdateReceiver::class.java)
                .putExtra(UpdateReceiver.EXTRA_CODE, app.versionCode)
                .putExtra(UpdateReceiver.EXTRA_NAME, app.versionName)
            // The installer adds its result to this intent, so it must be mutable.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            session.commit(PendingIntent.getBroadcast(context, sessionId, intent, flags).intentSender)
        }
    }

    private fun setStatus(text: String?) {
        if (text == status) return
        store(context).edit().putString(KEY_STATUS, text).apply()
        onStatus()
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

    companion object {
        private const val TAG = "Updater"
        private const val PREFS = "darpan-update"
        private const val KEY_STATUS = "status"
        private const val KEY_FAILED_CODE = "failedCode"
        private const val KEY_FAILED_AT = "failedAt"
        private const val SPREAD_MS = 10 * 60_000L
        private const val RETRY_AFTER_MS = 6 * 3_600_000L

        private fun store(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** Remembers a failed version so it is not retried for a few hours. */
        fun recordFailure(context: Context, versionCode: Int, message: String) {
            store(context).edit()
                .putString(KEY_STATUS, message.take(190))
                .putInt(KEY_FAILED_CODE, versionCode)
                .putLong(KEY_FAILED_AT, System.currentTimeMillis())
                .commit()
            File(context.filesDir, "update.apk").delete()
        }
    }
}
