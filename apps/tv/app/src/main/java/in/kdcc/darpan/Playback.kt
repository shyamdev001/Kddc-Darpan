package `in`.kdcc.darpan

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.widget.ImageView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.coroutines.resume

/** What the screen is doing, for MainActivity. */
enum class PlayState {
    /** Showing content. */
    PLAYING,

    /** Nothing playable right now (no playlist, or files still downloading). */
    NOTHING,

    /** Outside display hours: black screen, nothing plays. */
    OFF_HOURS,

    /** Stopped (pairing, signed out). */
    STOPPED,
}

/** One step of the loop: a verified file and how long it stays up. */
private class Cue(val item: ManifestItem, val durationSec: Int)

/** The playlist that applies right now and its playable steps. */
private class Queue(val key: String, val cues: List<Cue>)

/**
 * Plays the manifest in a loop: posters in two ImageViews that crossfade, videos in a single
 * ExoPlayer. Picks the first playlist whose time slots match India time, goes dark outside
 * display hours, and skips ads outside their dates, all without the network.
 * Only files already verified in the cache are played. Runs on the main thread.
 */
class Playback(
    private val context: Context,
    private val imageA: ImageView,
    private val imageB: ImageView,
    private val videoView: PlayerView,
    private val cache: MediaCache,
    private val scope: CoroutineScope,
    private val onState: (PlayState) -> Unit,
) {
    /** What is on screen now; sent in the heartbeat. */
    @Volatile
    var currentMediaId: String? = null
        private set

    private var manifest: Manifest? = null
    private var loop: Job? = null
    private var position = -1
    private var queueKey: String? = null
    private var state: PlayState? = null
    private var front: ImageView = imageA
    private var back: ImageView = imageB
    private var exo: ExoPlayer? = null
    private var preloaded: Pair<String, Bitmap>? = null

    private val maxSide: Int
    private val minSide: Int
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    init {
        val dm = context.resources.displayMetrics
        maxSide = maxOf(dm.widthPixels, dm.heightPixels)
        minSide = minOf(dm.widthPixels, dm.heightPixels)
    }

    fun setManifest(m: Manifest) {
        manifest = m
        if (loop?.isActive != true) loop = scope.launch { run() }
    }

    fun stop() {
        loop?.cancel()
        loop = null
        manifest = null
        currentMediaId = null
        preloaded = null
        exo?.stop()
        videoView.visibility = View.GONE
        imageA.setImageDrawable(null)
        imageB.setImageDrawable(null)
        queueKey = null
        setState(PlayState.STOPPED)
    }

    private fun setState(s: PlayState) {
        if (state != s) {
            state = s
            onState(s)
        }
    }

    /** Clears the screen to black (display hours ended). */
    private fun blank() {
        currentMediaId = null
        preloaded = null
        queueKey = null
        exo?.stop()
        videoView.visibility = View.GONE
        imageA.animate().cancel()
        imageB.animate().cancel()
        imageA.setImageDrawable(null)
        imageB.setImageDrawable(null)
    }

    fun release() {
        stop()
        videoView.player = null
        exo?.release()
        exo = null
    }

    private fun playable(item: ManifestItem?, now: Long): Boolean = item != null && inDateRange(item, now) && cache.has(item)

    /**
     * The first playlist whose slots match now and that has something ready to show. A timed
     * playlist whose files are not downloaded yet falls through to the next one.
     */
    private fun queueNow(m: Manifest, now: Long): Queue? {
        if (m.playlists.isEmpty()) {
            // manifest from an older server: one list, in order
            val cues = m.items.filter { playable(it, now) }.map { Cue(it, it.durationSec) }
            return if (cues.isEmpty()) null else Queue("items", cues)
        }
        val byId = m.items.associateBy { it.mediaId }
        for (p in m.playlists) {
            if (!Schedule.slotsActive(p.slots, now)) continue
            val cues = p.items.mapNotNull { e -> byId[e.mediaId]?.takeIf { playable(it, now) }?.let { Cue(it, e.durationSec) } }
            if (cues.isNotEmpty()) return Queue(p.id, cues)
        }
        return null
    }

    private fun inDateRange(item: ManifestItem, now: Long): Boolean {
        val from = item.validFrom?.let { parseTime(it) }
        val until = item.validUntil?.let { parseTime(it) }
        return (from == null || now >= from) && (until == null || now <= until)
    }

    private fun parseTime(s: String): Long? = try {
        iso.parse(s)?.time
    } catch (e: Exception) {
        null
    }

    private suspend fun run() {
        while (scope.isActive) {
            val m = manifest
            val now = System.currentTimeMillis()
            if (m == null) {
                delay(1_000)
                continue
            }
            if (!Schedule.hoursOn(m.settings.hours, now)) {
                if (state != PlayState.OFF_HOURS) {
                    blank()
                    setState(PlayState.OFF_HOURS)
                }
                delay(15_000) // checks again; turns back on within 15 s of the on time
                continue
            }
            val queue = queueNow(m, now)
            if (queue == null) {
                currentMediaId = null
                setState(PlayState.NOTHING)
                delay(5_000) // new downloads or a new manifest are picked up on the next pass
                continue
            }
            setState(PlayState.PLAYING)
            if (queue.key != queueKey) {
                // a different playlist took over (time slot started or ended): start it from the top
                queueKey = queue.key
                position = -1
                preloaded = null
            }
            val cues = queue.cues
            position = (position + 1) % cues.size
            val cue = cues[position]
            val item = cue.item
            val shown = try {
                if (item.isVideo) playVideo(item, cue.durationSec) else showImage(cue, cues)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.w(TAG, "Could not play ${item.mediaId}", e)
                false
            }
            if (!shown) delay(1_000)
        }
    }

    private suspend fun showImage(cue: Cue, cues: List<Cue>): Boolean {
        val item = cue.item
        val started = SystemClock.elapsedRealtime()
        val ready = preloaded?.takeIf { it.first == item.sha256 }?.second
        preloaded = null
        val bitmap = ready ?: withContext(Dispatchers.IO) { decode(cache.fileFor(item)) }
        if (bitmap == null) {
            cache.discard(item) // corrupt file: download it again on the next sync
            return false
        }

        val incoming = back
        val outgoing = front
        incoming.setImageBitmap(bitmap)
        incoming.alpha = 0f
        incoming.animate().alpha(1f).setDuration(FADE_MS).start()
        outgoing.animate().alpha(0f).setDuration(FADE_MS).start()
        front = incoming
        back = outgoing
        if (videoView.visibility == View.VISIBLE) {
            videoView.visibility = View.GONE
            exo?.stop()
        }
        currentMediaId = item.mediaId

        delay(FADE_MS)
        outgoing.setImageDrawable(null)

        // Decode the next poster now, so it is ready the moment this one's time is up.
        val next = cues.getOrNull((position + 1) % cues.size)?.item
        if (next != null && !next.isVideo && next.sha256 != item.sha256) {
            preloaded = withContext(Dispatchers.IO) { decode(cache.fileFor(next)) }?.let { next.sha256 to it }
        }

        val remaining = cue.durationSec * 1000L - (SystemClock.elapsedRealtime() - started)
        delay(remaining.coerceAtLeast(1_000))
        return true
    }

    private suspend fun playVideo(item: ManifestItem, durationSec: Int): Boolean {
        val player = exo ?: ExoPlayer.Builder(context).build().also {
            exo = it
            videoView.player = it
        }
        player.setMediaItem(MediaItem.fromUri(Uri.fromFile(cache.fileFor(item))))
        player.prepare()
        videoView.visibility = View.VISIBLE
        player.play()
        currentMediaId = item.mediaId

        // Play to the end, or stop at durationSec when the playlist trims the video.
        val limitMs = durationSec * 1000L + 1_500
        val result = withTimeoutOrNull(limitMs) {
            suspendCancellableCoroutine<Boolean> { cont ->
                val listener = object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        if (playbackState == Player.STATE_ENDED) {
                            player.removeListener(this)
                            if (cont.isActive) cont.resume(true)
                        }
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        player.removeListener(this)
                        if (cont.isActive) cont.resume(false)
                    }
                }
                player.addListener(listener)
                cont.invokeOnCancellation { videoView.post { player.removeListener(listener) } }
            }
        }
        if (result == false) {
            Log.w(TAG, "Video ${item.mediaId} failed to play; will download again")
            player.stop()
            videoView.visibility = View.GONE
            cache.discard(item)
            return false
        }
        // The last frame stays up until the next item replaces it.
        return true
    }

    /** Decodes at no more than screen size, to keep memory low on 1.7 GB TVs. */
    private fun decode(file: File): Bitmap? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            null
        } else {
            val longSide = maxOf(bounds.outWidth, bounds.outHeight)
            val shortSide = minOf(bounds.outWidth, bounds.outHeight)
            var sample = 1
            while (longSide / (sample * 2) >= maxSide && shortSide / (sample * 2) >= minSide) sample *= 2
            BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
        }
    } catch (e: OutOfMemoryError) {
        Log.e(TAG, "Out of memory decoding ${file.name}")
        null
    }

    private companion object {
        const val TAG = "Playback"
        const val FADE_MS = 600L
    }
}
