package `in`.kdcc.darpan

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume

/**
 * What this app is showing, as a small JPEG for the dashboard. On Android 8+ PixelCopy reads the
 * window as composed, video included; older TVs fall back to drawing the views (video shows black).
 */
object Screenshot {
    private const val MAX_WIDTH = 1280

    /** Call on the main thread. Returns null if the window could not be read. */
    suspend fun capture(activity: Activity): ByteArray? {
        val view = activity.window.decorView
        val w = view.width
        val h = view.height
        if (w <= 0 || h <= 0) return null
        val full = try {
            Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        } catch (e: OutOfMemoryError) {
            return null
        }
        val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            suspendCancellableCoroutine { cont ->
                try {
                    PixelCopy.request(activity.window, full, { result ->
                        if (cont.isActive) cont.resume(result == PixelCopy.SUCCESS)
                    }, Handler(Looper.getMainLooper()))
                } catch (e: IllegalArgumentException) {
                    if (cont.isActive) cont.resume(false) // window not ready
                }
            }
        } else {
            view.draw(Canvas(full))
            true
        }
        if (!ok) {
            full.recycle()
            return null
        }
        return withContext(Dispatchers.Default) {
            val scaled = if (w > MAX_WIDTH) Bitmap.createScaledBitmap(full, MAX_WIDTH, h * MAX_WIDTH / w, true) else full
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 75, out)
            if (scaled !== full) scaled.recycle()
            full.recycle()
            out.toByteArray()
        }
    }
}
