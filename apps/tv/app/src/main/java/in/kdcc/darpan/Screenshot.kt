package `in`.kdcc.darpan

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume

/** The JPEG, and whether a playing video's area came out black (null: no video on screen). */
class Capture(val jpeg: ByteArray, val videoBlack: Boolean?)

/**
 * What this app is showing, as a small JPEG for the dashboard. PixelCopy (Android 8+) reads the
 * window; whether that includes the video depends on the TV (ExoPlayer draws on its own surface),
 * so when a video is on screen its area is checked and a black one is reported (see BlackFrame).
 * Older TVs fall back to drawing the views, where video always shows black.
 */
object Screenshot {
    private const val MAX_WIDTH = 1280
    private const val SAMPLES_X = 32
    private const val SAMPLES_Y = 18

    /** Call on the main thread. Returns null if the window could not be read. */
    suspend fun capture(activity: Activity, video: View? = null): Capture? {
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
        val videoBlack = video?.let { videoArea(it, full) }?.let { BlackFrame.isBlack(it) }
        return withContext(Dispatchers.Default) {
            val scaled = if (w > MAX_WIDTH) Bitmap.createScaledBitmap(full, MAX_WIDTH, h * MAX_WIDTH / w, true) else full
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 75, out)
            if (scaled !== full) scaled.recycle()
            full.recycle()
            Capture(out.toByteArray(), videoBlack)
        }
    }

    /** A grid of pixels from where the video view sits in the window; null if it is not on screen. */
    private fun videoArea(video: View, window: Bitmap): IntArray? {
        if (!video.isShown || video.width <= 0 || video.height <= 0) return null
        val at = IntArray(2)
        video.getLocationInWindow(at)
        val left = at[0].coerceIn(0, window.width - 1)
        val top = at[1].coerceIn(0, window.height - 1)
        val right = (at[0] + video.width).coerceIn(left + 1, window.width)
        val bottom = (at[1] + video.height).coerceIn(top + 1, window.height)
        return IntArray(SAMPLES_X * SAMPLES_Y) { i ->
            val x = left + (right - left - 1) * (i % SAMPLES_X) / (SAMPLES_X - 1)
            val y = top + (bottom - top - 1) * (i / SAMPLES_X) / (SAMPLES_Y - 1)
            window.getPixel(x, y)
        }
    }
}
