package `in`.kdcc.darpan

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.widget.ImageView
import androidx.media3.common.C
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

    /** A broadcast from head office has the screen; the playlists wait. */
    BROADCAST,
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
    /** Records what was shown, for proof of play. */
    private val plays: PlayLogStore,
    private val scope: CoroutineScope,
    private val onState: (PlayState) -> Unit,
    /** While nothing plays: a short plain-English reason, refreshed every few seconds. */
    private val onIdleReason: (String) -> Unit,
    /** A different item came on screen: worth telling the server at once (the dashboard's Live wall). */
    private val onNowPlaying: () -> Unit = {},
) {
    /** The video view while a video is on screen, for the screenshot check; null otherwise. */
    val videoOnScreen: android.view.View?
        get() = videoView.takeIf { it.visibility == android.view.View.VISIBLE && exo?.isPlaying == true }

    /** What is on screen now; sent in the heartbeat. */
    @Volatile
    var currentMediaId: String? = null
        private set

    private fun nowPlaying(mediaId: String) {
        val changed = currentMediaId != mediaId
        currentMediaId = mediaId
        if (changed) onNowPlaying()
    }

    private var manifest: Manifest? = null
    private var loop: Job? = null
    private var position = -1
    private var queueKey: String? = null
    private var state: PlayState? = null
    private var front: ImageView = imageA
    private var back: ImageView = imageB
    private var exo: ExoPlayer? = null
    private var preloaded: Pair<String, Bitmap>? = null

    /** The default slide's file while it is on screen, so it is not faded in again every pass. */
    private var fallbackShown: String? = null

    /** Kept in step: the timeline step on screen (loop, index, start), so it is not shown twice. */
    private var syncShown: String? = null

    /** True while the branch keeps its screens in step (manifest setting). */
    val syncing: Boolean get() = manifest?.settings?.sync == true

    /** Kept in step: how far the video on screen is from the shared timeline (+ = ahead), for the heartbeat. */
    @Volatile
    var driftMs: Long? = null
        private set

    private val maxSide: Int
    private val minSide: Int
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    init {
        val dm = context.resources.displayMetrics
        maxSide = maxOf(dm.widthPixels, dm.heightPixels)
        minSide = minOf(dm.widthPixels, dm.heightPixels)
    }

    /** True while a broadcast has the screen. */
    private var held = false

    fun setManifest(m: Manifest) {
        manifest = m
        if (!held && loop?.isActive != true) loop = scope.launch { run() }
    }

    /**
     * Gives the screen to a broadcast (true) or takes it back (false). While held, the player is
     * released so only one ExoPlayer exists at a time on these low-memory TVs.
     */
    fun hold(on: Boolean) {
        if (on == held) return
        held = on
        if (on) {
            loop?.cancel()
            loop = null
            blank()
            videoView.player = null
            exo?.release()
            exo = null
            setState(PlayState.BROADCAST)
        } else {
            position = -1
            if (manifest != null) loop = scope.launch { run() }
        }
    }

    fun stop() {
        held = false
        plays.end()
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
        syncShown = null
        driftMs = null
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
        plays.end()
        currentMediaId = null
        fallbackShown = null
        syncShown = null
        driftMs = null
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
    private fun queueNow(m: Manifest, now: Long, clockCertain: Boolean = true): Queue? {
        if (m.playlists.isEmpty()) {
            // manifest from an older server: one list, in order
            val cues = m.items.filter { playable(it, now) }.map { Cue(it, it.durationSec) }
            return if (cues.isEmpty()) null else Queue("items", cues)
        }
        val byId = m.items.associateBy { it.mediaId }
        for (p in m.playlists) {
            // Unsure what time it is: only the always-on layer, never a time slot that may be wrong.
            if (!clockCertain && p.slots.isNotEmpty()) continue
            if (!Schedule.slotsActive(p.slots, now)) continue
            val cues = p.items.mapNotNull { e -> byId[e.mediaId]?.takeIf { playable(it, now) }?.let { Cue(it, e.durationSec) } }
            if (cues.isNotEmpty()) return Queue(p.id, cues)
        }
        return null
    }

    /** Why queueNow found nothing, for the idle screen. */
    private fun idleReason(m: Manifest, now: Long): String {
        val files = m.items.distinctBy { it.sha256 }
        val ready = files.count { cache.has(it) }
        val inDates = m.items.count { inDateRange(it, now) }
        val why = when {
            m.items.isEmpty() -> "No playlist is assigned to this screen."
            ready == 0 -> "Files not downloaded yet (0 of ${files.size})."
            inDates == 0 -> "Every ad is outside its start/end dates."
            !TrustedClock.certain && m.playlists.all { it.slots.isNotEmpty() } -> "TV clock not set yet: waiting for the internet to play timed playlists."
            m.playlists.isNotEmpty() && m.playlists.none { Schedule.slotsActive(it.slots, now) } -> "No playlist is set for this time."
            else -> "Nothing ready to play in the current playlist."
        }
        val clock = SimpleDateFormat("d MMM yyyy, h:mm a", Locale.US).apply { timeZone = TimeZone.getTimeZone("Asia/Kolkata") }.format(now)
        return "$why\nFiles ready: $ready of ${files.size} · Playlists: ${m.playlists.size} · TV clock: $clock IST · v${BuildConfig.VERSION_NAME}"
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
        val pulse = PlaybackPulse.start(SystemClock.elapsedRealtime())
        try {
            loopForever()
        } finally {
            PlaybackPulse.stop(pulse)
        }
    }

    private suspend fun loopForever() {
        while (scope.isActive) {
            PlaybackPulse.beat(SystemClock.elapsedRealtime())
            val m = manifest
            val now = TrustedClock.now()
            val clockCertain = TrustedClock.certain
            if (m == null) {
                delay(1_000)
                continue
            }
            // Unsure what time it is (power cut, no internet yet): stay on rather than go dark.
            if (clockCertain && !Schedule.hoursOn(m.settings.hours, now)) {
                if (state != PlayState.OFF_HOURS) {
                    blank()
                    setState(PlayState.OFF_HOURS)
                }
                delay(15_000) // checks again; turns back on within 15 s of the on time
                continue
            }
            if (m.settings.sync) {
                syncedPass(m, clockCertain)
                continue
            }
            syncShown = null
            driftMs = null
            val queue = queueNow(m, now, clockCertain)
            if (queue == null) {
                idle(m, idleReason(m, now))
                delay(5_000) // new downloads or a new manifest are picked up on the next pass
                continue
            }
            fallbackShown = null
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
            PlaybackPulse.beat(SystemClock.elapsedRealtime(), cue.durationSec * 1000L)
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

    /** Nothing to play: the default slide if the TV has it (never a blank or technical screen in opening hours). */
    private suspend fun idle(m: Manifest, reason: String) {
        if (currentMediaId != null && fallbackShown == null) plays.end()
        onIdleReason(reason)
        val fallback = m.fallbackMediaId?.let { id -> m.items.firstOrNull { it.mediaId == id } }?.takeIf { cache.has(it) }
        if (fallback == null || !showFallback(fallback)) {
            currentMediaId = null
            fallbackShown = null
            if (videoView.visibility == View.VISIBLE) {
                exo?.stop()
                videoView.visibility = View.GONE
            }
            setState(PlayState.NOTHING)
        }
    }

    /**
     * One look at the shared timeline, for a branch kept in step (docs: SYNC_DESIGN.md): shows the
     * step due now unless it is up already, then waits for the next moment anything can change (the
     * step's end, an ad's dates, a whole minute for time slots). Every screen in the branch does the
     * same sums with the server's time, so they switch together.
     */
    private suspend fun syncedPass(m: Manifest, clockCertain: Boolean) {
        val now = SyncClock.now()
        val plan = SyncPlan.at(m, now, clockCertain)
        if (plan == null) {
            syncShown = null
            driftMs = null
            idle(m, idleReason(m, now))
            delay((SyncPlan.nextMinute(now) - now).coerceIn(1L, 5_000L))
            return
        }
        val pos = Timeline.at(plan.steps, plan.anchorMs, now) ?: return
        val item = plan.items[pos.index]
        val until = minOf(pos.endsAt, plan.changesAt ?: Long.MAX_VALUE, SyncPlan.nextMinute(now))
        PlaybackPulse.beat(SystemClock.elapsedRealtime(), until - now)
        val key = "${plan.key}#${pos.index}@${pos.startedAt}"
        if (key != syncShown) {
            syncShown = key
            // If the branch stops keeping in step, the own-pace loop starts from the top.
            queueKey = null
            position = -1
            val shown = cache.has(item) && try {
                if (item.isVideo) startSyncedVideo(item, pos.startedAt) else putUpImage(item)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.w(TAG, "Could not play ${item.mediaId}", e)
                false
            }
            if (shown) {
                fallbackShown = null
                setState(PlayState.PLAYING)
                if (!item.isVideo) driftMs = null
            } else {
                // Same timeline: the default slide fills this step, and the next one still comes on time.
                driftMs = null
                idle(m, "This ad is not on the TV yet; the default slide fills its turn.")
            }
            // Decode the next poster now, so it is up the moment this step ends.
            val next = Timeline.at(plan.steps, plan.anchorMs, pos.endsAt)?.let { plan.items[it.index] }
            if (next != null && !next.isVideo && next.sha256 != item.sha256 && preloaded?.first != next.sha256 && cache.has(next)) {
                preloaded = withContext(Dispatchers.IO) { decode(cache.fileFor(next)) }?.let { next.sha256 to it }
            }
            if (next != null && next.isVideo && videoView.visibility != View.VISIBLE && cache.has(next)) prepareAhead(next)
        }
        if (item.isVideo && videoView.visibility == View.VISIBLE && currentMediaId == item.mediaId) {
            keepVideoInStep(m, item, pos.startedAt, until)
        } else {
            delay((until - SyncClock.now()).coerceAtLeast(1L))
        }
    }

    /** Starts a timeline video where the other screens are: at its start, or mid-way when joining late. */
    private suspend fun startSyncedVideo(item: ManifestItem, startedAt: Long): Boolean {
        val player = player()
        player.setPlaybackSpeed(1f)
        val want = SyncClock.now() - startedAt
        openVideo(player, item, if (want > Timeline.SEEK_ABOVE_MS) want + OPEN_LEAD_MS else 0L)
        if (!awaitReady(player)) return videoFailed(player, item)
        showVideoView()
        player.play()
        nowPlaying(item.mediaId)
        plays.start(item.mediaId)
        driftMs = null
        return true
    }

    /**
     * Holds a video to the shared timeline until [until]: a seek when it is more than 500 ms off, 2 %
     * faster or slower when it is a little off (nobody notices). The gap measured goes in the heartbeat.
     */
    private suspend fun keepVideoInStep(m: Manifest, item: ManifestItem, startedAt: Long, until: Long) {
        val player = exo ?: return
        var lastSeek = 0L
        while (true) {
            val now = SyncClock.now()
            if (now >= until) return
            PlaybackPulse.beat(SystemClock.elapsedRealtime(), until - now)
            if (player.playerError != null) {
                Log.w(TAG, "Video ${item.mediaId} failed to play; will download again")
                plays.cancel()
                player.stop()
                videoView.visibility = View.GONE
                cache.discard(item)
                driftMs = null
                idle(m, "This ad could not play and is downloading again; the default slide fills its turn.")
                delay((until - SyncClock.now()).coerceAtLeast(1L))
                return
            }
            val want = now - startedAt
            val length = player.duration
            // Only while it is really playing, and not in its last moments (it may end before its step).
            if (player.playbackState == Player.STATE_READY && player.isPlaying && (length == C.TIME_UNSET || want < length - 300)) {
                val drift = player.currentPosition - want
                driftMs = drift
                when (val c = Timeline.correction(drift, want, SystemClock.elapsedRealtime() - lastSeek)) {
                    is Timeline.Correction.Seek -> {
                        player.seekTo(c.toMs)
                        lastSeek = SystemClock.elapsedRealtime()
                    }
                    is Timeline.Correction.Speed -> if (player.playbackParameters.speed != c.speed) player.setPlaybackSpeed(c.speed)
                }
            }
            delay(minOf(VIDEO_CHECK_MS, until - now).coerceAtLeast(1L))
        }
    }

    /** Puts the default slide up (crossfade), unless it is already up. Not a play: nothing is logged. */
    private suspend fun showFallback(item: ManifestItem): Boolean {
        if (fallbackShown == item.sha256) return true
        val bitmap = withContext(Dispatchers.IO) { decode(cache.fileFor(item)) }
        if (bitmap == null) {
            cache.discard(item)
            return false
        }
        plays.end()
        setState(PlayState.PLAYING)
        val outgoing = present(bitmap)
        nowPlaying(item.mediaId)
        fallbackShown = item.sha256
        delay(FADE_MS)
        outgoing.setImageDrawable(null)
        return true
    }

    /** Crossfades [bitmap] in over whatever is up, hides a video; returns the view to clear after the fade. */
    private fun present(bitmap: Bitmap): ImageView {
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
        return outgoing
    }

    /** Crossfades a poster in (the decoded copy if ready) and records the play; false if the file is bad. */
    private suspend fun putUpImage(item: ManifestItem): Boolean {
        val ready = preloaded?.takeIf { it.first == item.sha256 }?.second
        preloaded = null
        val bitmap = ready ?: withContext(Dispatchers.IO) { decode(cache.fileFor(item)) }
        if (bitmap == null) {
            cache.discard(item) // corrupt file: download it again on the next sync
            return false
        }
        val outgoing = present(bitmap)
        nowPlaying(item.mediaId)
        plays.start(item.mediaId)
        delay(FADE_MS)
        outgoing.setImageDrawable(null)
        return true
    }

    private suspend fun showImage(cue: Cue, cues: List<Cue>): Boolean {
        val item = cue.item
        val started = SystemClock.elapsedRealtime()
        if (!putUpImage(item)) return false

        // Decode the next poster now, so it is ready the moment this one's time is up.
        val next = cues.getOrNull((position + 1) % cues.size)?.item
        if (next != null && !next.isVideo && next.sha256 != item.sha256) {
            preloaded = withContext(Dispatchers.IO) { decode(cache.fileFor(next)) }?.let { next.sha256 to it }
        }
        // And open the next video, paused at its start, so it replaces this poster without a black gap.
        if (next != null && next.isVideo) prepareAhead(next)

        val remaining = cue.durationSec * 1000L - (SystemClock.elapsedRealtime() - started)
        delay(remaining.coerceAtLeast(1_000))
        return true
    }

    /** The one ExoPlayer, made when first needed and reused for every video. */
    private fun player(): ExoPlayer = exo ?: ExoPlayer.Builder(context).build().also {
        exo = it
        videoView.player = it
    }

    private fun videoItem(item: ManifestItem): MediaItem =
        MediaItem.Builder().setUri(Uri.fromFile(cache.fileFor(item))).setMediaId(item.sha256).build()

    /**
     * Loads a video, paused, at [fromMs]. One opened ahead by [prepareAhead] and still waiting is
     * used as it is. Nothing is on screen yet: the caller reveals it once [awaitReady].
     */
    private fun openVideo(player: ExoPlayer, item: ManifestItem, fromMs: Long) {
        val waiting = player.currentMediaItem?.mediaId == item.sha256 && !player.playWhenReady && player.playerError == null &&
            (player.playbackState == Player.STATE_READY || player.playbackState == Player.STATE_BUFFERING)
        if (waiting) {
            if (fromMs > 0) player.seekTo(fromMs)
            return
        }
        player.playWhenReady = false
        player.setMediaItem(videoItem(item), fromMs)
        player.prepare()
    }

    /** While a poster is up, opens the next video paused at its start (one decoder, no picture yet). */
    private fun prepareAhead(item: ManifestItem) {
        val player = player()
        player.setPlaybackSpeed(1f)
        openVideo(player, item, 0L)
    }

    /**
     * Waits, with the poster still on screen, until the video's first frame is decoded, so the
     * switch shows no black gap. False if the file cannot play. Gives up waiting after 3 s.
     */
    private suspend fun awaitReady(player: ExoPlayer): Boolean {
        withTimeoutOrNull(READY_WAIT_MS) {
            while (player.playerError == null && player.playbackState != Player.STATE_READY && player.playbackState != Player.STATE_ENDED) delay(20)
        }
        return player.playerError == null
    }

    private fun videoFailed(player: ExoPlayer, item: ManifestItem): Boolean {
        Log.w(TAG, "Video ${item.mediaId} could not be opened; will download again")
        player.stop()
        cache.discard(item)
        return false
    }

    private fun showVideoView() {
        videoView.visibility = View.VISIBLE
        // A video narrower or shorter than the screen leaves bars; they must be black, never the
        // last poster peeking out from underneath. Clearing the posters also frees their memory.
        for (v in listOf(imageA, imageB)) {
            v.animate().cancel()
            v.alpha = 0f
            v.setImageDrawable(null)
        }
        preloaded = null
    }

    private suspend fun playVideo(item: ManifestItem, durationSec: Int): Boolean {
        val player = player()
        player.setPlaybackSpeed(1f) // a branch just taken off the shared timeline may have left it nudged
        openVideo(player, item, 0L)
        // The poster stays up while the file opens and its first frame decodes: no black gap.
        if (!awaitReady(player)) return videoFailed(player, item)
        showVideoView()
        player.play()
        nowPlaying(item.mediaId)
        plays.start(item.mediaId)

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
            plays.cancel()
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
        const val VIDEO_CHECK_MS = 500L
        const val READY_WAIT_MS = 3_000L

        /** Opening a video mid-way takes the player a moment; start it this far on so it lands in step. */
        const val OPEN_LEAD_MS = 400L
    }
}
