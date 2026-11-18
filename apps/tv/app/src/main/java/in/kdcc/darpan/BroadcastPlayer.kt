package `in`.kdcc.darpan

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs

/**
 * Shows a broadcast from head office on top of everything: a full-screen message, a poster or
 * video, a live stream (ExoPlayer) or a YouTube video (YouTube's own player in a WebView, only
 * while the broadcast runs). Views are built when needed and torn down afterwards, so normal
 * playback stays as light as before. Runs on the main thread.
 */
class BroadcastPlayer(
    private val activity: Activity,
    private val stage: FrameLayout,
    private val cache: MediaCache,
    private val prefs: Prefs,
    private val scope: CoroutineScope,
    /** It ended by itself (its time was up): the playlists can take over again. */
    private val onEnded: () -> Unit,
    /** Status changed; worth a heartbeat so the dashboard sees it. */
    private val onStatus: () -> Unit,
) {
    /** The broadcast on screen, for the heartbeat; null when none. */
    var currentId: String? = null
        private set

    /** "loading", "playing" or "error: ..."; null when none. */
    var status: String? = null
        private set

    private var current: ManifestBroadcast? = null
    private var overlay: FrameLayout? = null
    private var exo: ExoPlayer? = null
    private var web: WebView? = null
    private var watcher: Job? = null
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    /** True when `b` should be on screen now (not ended by its time). */
    fun isLive(b: ManifestBroadcast?): Boolean {
        if (b == null) return false
        val ends = b.endsAt?.let { parseTime(it) } ?: return true
        return TrustedClock.now() < ends
    }

    /** Shows `b`, or clears the screen when null or over. Same broadcast again: nothing changes. */
    fun show(b: ManifestBroadcast?) {
        if (b == null || !isLive(b)) {
            stop()
            return
        }
        if (b == current) return
        stop()
        current = b
        currentId = b.id
        build(b)
        watcher = scope.launch { watch(b) }
    }

    fun stop() {
        watcher?.cancel()
        watcher = null
        exo?.release()
        exo = null
        web?.let {
            it.stopLoading()
            it.loadUrl("about:blank")
            (it.parent as? FrameLayout)?.removeView(it)
            it.destroy()
        }
        web = null
        overlay?.let { stage.removeView(it) }
        overlay = null
        val had = current != null
        current = null
        currentId = null
        status = null
        if (had) onStatus()
    }

    private fun setStatus(s: String) {
        if (status == s) return
        status = s
        onStatus()
    }

    /** Ends it on time even with no network, and notices a stalled start. */
    private suspend fun watch(b: ManifestBroadcast) {
        val started = System.currentTimeMillis()
        while (scope.isActive && current == b) {
            if (!isLive(b)) {
                stop()
                onEnded()
                return
            }
            web?.evaluateJavascript("OFFSET=${SyncClock.now() - System.currentTimeMillis()}", null)
            if (status == "loading" && System.currentTimeMillis() - started > START_TIMEOUT_MS) {
                setStatus("error: not started after ${START_TIMEOUT_MS / 1000} s (check this TV's internet)")
            }
            delay(5_000)
        }
    }

    // ---------- Views ----------

    private fun build(b: ManifestBroadcast) {
        val box = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
        stage.addView(box, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        overlay = box

        val media = b.media
        val link = b.link
        when {
            b.kind == "MEDIA" && media != null -> if (media.isVideo) playVideo(box, b, media) else showPoster(box, b, media)
            b.kind == "LINK" && link?.type == "youtube" && link.youtubeId != null -> playYoutube(box, b, link.youtubeId)
            b.kind == "LINK" && link?.type == "stream" && link.url != null -> playStream(box, b, link.url)
            else -> {
                box.addView(messagePanel(b), FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
                setStatus("playing")
                return
            }
        }
        // Over pictures and video: the heading in a corner, the message as a strip along the bottom.
        b.title?.takeIf { it.isNotBlank() }?.let {
            box.addView(badge(it), FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.TOP or Gravity.START).apply { setMargins(dp(32), dp(32), 0, 0) })
        }
        b.message?.takeIf { it.isNotBlank() }?.let {
            box.addView(strip(it), FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM))
        }
    }

    private fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, activity.resources.displayMetrics)
    private fun dp(v: Int) = (v * activity.resources.displayMetrics.density).toInt()

    private fun messagePanel(b: ManifestBroadcast): View {
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(INK)
            setPadding(dp(96), dp(48), dp(96), dp(48))
        }
        panel.addView(View(activity).apply { setBackgroundColor(HALDI) }, LinearLayout.LayoutParams(dp(120), dp(8)).apply { bottomMargin = dp(28) })
        panel.addView(TextView(activity).apply {
            text = b.title?.takeIf { it.isNotBlank() } ?: "Important notice"
            setTextColor(HALDI)
            setTextSize(TypedValue.COMPLEX_UNIT_PX, sp(30f))
            typeface = Typeface.DEFAULT_BOLD
        })
        panel.addView(TextView(activity).apply {
            text = b.message ?: ""
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_PX, sp(if ((b.message?.length ?: 0) > 160) 40f else 56f))
            typeface = Typeface.DEFAULT_BOLD
            setLineSpacing(0f, 1.15f)
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(20) })
        return panel
    }

    private fun badge(text: String) = TextView(activity).apply {
        this.text = text
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_PX, sp(22f))
        typeface = Typeface.DEFAULT_BOLD
        setBackgroundColor(RED)
        setPadding(dp(18), dp(8), dp(18), dp(8))
    }

    private fun strip(text: String) = TextView(activity).apply {
        this.text = text
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_PX, sp(28f))
        typeface = Typeface.DEFAULT_BOLD
        setBackgroundColor(Color.argb(235, 20, 25, 54))
        setPadding(dp(32), dp(14), dp(32), dp(14))
        maxLines = 2
        ellipsize = TextUtils.TruncateAt.END
    }

    // ---------- Poster ----------

    private fun showPoster(box: FrameLayout, b: ManifestBroadcast, item: ManifestItem) {
        val view = ImageView(activity).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
        box.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setStatus("loading")
        scope.launch {
            // MainActivity downloads broadcast files first; wait for it.
            while (current == b && !cache.has(item)) delay(2_000)
            if (current != b) return@launch
            val bmp = withContext(Dispatchers.IO) {
                try {
                    val path = cache.fileFor(item).path
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(path, bounds)
                    var sample = 1
                    while (bounds.outWidth / (sample * 2) >= 1920 && bounds.outHeight / (sample * 2) >= 1080) sample *= 2
                    BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
                } catch (e: OutOfMemoryError) {
                    null
                }
            }
            if (current != b) return@launch
            if (bmp == null) {
                setStatus("error: the poster file could not be opened")
                cache.discard(item)
            } else {
                view.setImageBitmap(bmp)
                setStatus("playing")
            }
        }
    }

    // ---------- Video and streams (ExoPlayer) ----------

    private fun player(box: FrameLayout, b: ManifestBroadcast): ExoPlayer {
        // The device token lets the TV stream a library video before its download has finished.
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${prefs.deviceToken ?: ""}"))
        val p = ExoPlayer.Builder(activity, DefaultRenderersFactory(activity).setEnableDecoderFallback(true)).setMediaSourceFactory(DefaultMediaSourceFactory(activity).setDataSourceFactory(http)).build()
        p.volume = if (b.muted) 0f else 1f
        val view = PlayerView(activity).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            player = p
        }
        box.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) setStatus("playing")
                if (state == Player.STATE_BUFFERING && status != "playing") setStatus("loading")
            }

            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "Broadcast playback failed", error)
                setStatus("error: " + error.errorCodeName.removePrefix("ERROR_CODE_").lowercase(Locale.US).replace('_', ' '))
                // Live streams drop now and then: try again shortly.
                scope.launch {
                    delay(RETRY_MS)
                    if (current == b && exo === p) {
                        p.prepare()
                        p.play()
                    }
                }
            }
        })
        exo = p
        return p
    }

    private fun playVideo(box: FrameLayout, b: ManifestBroadcast, item: ManifestItem) {
        val p = player(box, b)
        val uri = if (cache.has(item)) Uri.fromFile(cache.fileFor(item)) else Uri.parse(item.url)
        p.setMediaItem(MediaItem.fromUri(uri))
        p.repeatMode = Player.REPEAT_MODE_ONE
        setStatus("loading")
        p.prepare()
        p.play()
        // Every screen plays the moment it would be at had it started with the broadcast, and keeps to it.
        val startMs = b.startedAt?.let { parseTime(it) } ?: return
        scope.launch { keepInStep(b, p, startMs) }
    }

    /**
     * Twice a second: how far is this screen from where every screen should be? A big gap is closed
     * with a seek; a small one by playing a few percent faster or slower until it is gone, which
     * nobody notices (a seek every time would stutter).
     */
    private suspend fun keepInStep(b: ManifestBroadcast, p: ExoPlayer, startMs: Long) {
        var speed = 1f
        var lastSeek = 0L
        while (current == b && exo === p) {
            delay(500)
            val len = p.duration
            if (!p.isPlaying || len <= 0) continue
            val want = ((SyncClock.now() - startMs) % len + len) % len
            var d = p.currentPosition - want
            if (d > len / 2) d -= len else if (d < -len / 2) d += len // across the loop point
            val t = System.currentTimeMillis()
            if (t - lastSeek < 1_500) continue
            val wanted = when {
                abs(d) > SEEK_GAP_MS -> {
                    lastSeek = t
                    p.seekTo((want + SEEK_LEAD_MS) % len)
                    1f
                }
                abs(d) > STEP_GAP_MS -> if (d < 0) 1.06f else 0.94f
                else -> 1f
            }
            if (wanted != speed) {
                speed = wanted
                p.setPlaybackSpeed(wanted)
            }
        }
    }

    private fun playStream(box: FrameLayout, b: ManifestBroadcast, url: String) {
        val p = player(box, b)
        val item = MediaItem.Builder().setUri(url)
        if (url.substringBefore('?').endsWith(".m3u8", ignoreCase = true)) item.setMimeType(MimeTypes.APPLICATION_M3U8)
        p.setMediaItem(item.build())
        p.repeatMode = Player.REPEAT_MODE_ONE // a recorded video loops; a live stream just plays on
        setStatus("loading")
        p.prepare()
        p.play()
    }

    // ---------- YouTube ----------

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun playYoutube(box: FrameLayout, b: ManifestBroadcast, videoId: String) {
        val w = WebView(activity)
        w.setBackgroundColor(Color.BLACK)
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true
        w.settings.mediaPlaybackRequiresUserGesture = false // play with sound, no remote click needed
        // YouTube's phone player shows its own buttons over the video; the desktop player with
        // controls=0 shows none. Ask for the desktop one.
        w.settings.userAgentString = DESKTOP_UA
        w.isFocusable = false
        w.isFocusableInTouchMode = false
        w.webChromeClient = WebChromeClient()
        w.webViewClient = object : WebViewClient() {
            // Stay on the player page: no navigating away to the YouTube site.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.isForMainFrame
        }
        w.addJavascriptInterface(Bridge(b), "Darpan")
        box.addView(w, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        // A clear cover on top: no remote key, touch or mouse can reach the player and bring up its controls.
        box.addView(View(activity).apply {
            isClickable = true
            isFocusable = false
            setOnTouchListener { _, _ -> true }
        }, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        web = w
        setStatus("loading")
        val startMs = b.startedAt?.let { parseTime(it) } ?: 0L
        // The page's clock runs on the device clock; tell it how far that is from the server's.
        val offsetMs = SyncClock.now() - System.currentTimeMillis()
        // The page's address is the app id: YouTube asks embedded players to say which app they are in.
        w.loadDataWithBaseURL("$ORIGIN/", youtubePage(videoId, b.muted, startMs, offsetMs), "text/html", "utf-8", null)
    }

    /** Messages from the YouTube page. It can only set a short status text. */
    private inner class Bridge(private val b: ManifestBroadcast) {
        @JavascriptInterface
        fun status(s: String) {
            val text = s.take(150)
            activity.runOnUiThread {
                if (current != b) return@runOnUiThread
                setStatus(text)
                if (text.startsWith("error")) {
                    scope.launch {
                        delay(RETRY_MS * 4)
                        if (current == b) web?.reload()
                    }
                }
            }
        }
    }

    /**
     * YouTube's player inside a bare page. A black cover hides YouTube's own title and buttons while
     * the video starts, loops or is paused (they show then even with controls off), and lifts once it
     * plays steadily. Every half second the page checks where this screen is against where every
     * screen should be: small gaps close by playing a touch faster or slower (not visible), big ones
     * by a seek that aims ahead by how late this TV's seeks have been landing.
     */
    private fun youtubePage(id: String, muted: Boolean, startMs: Long, offsetMs: Long): String = """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
          #p{position:fixed;top:0;left:0;width:100%;height:100%;border:0;pointer-events:none}
          #c{position:fixed;inset:0;background:#000;z-index:2;opacity:1;transition:opacity .5s}
        </style>
        </head><body><div id="p"></div><div id="c"></div>
        <script>
        var MUTED = $muted, START = $startMs, OFFSET = $offsetMs;
        var WHY = {2:'the link is not valid',5:'YouTube could not play it here',100:'the video was removed or is private',
                   101:'its owner does not allow playing it outside YouTube',150:'its owner does not allow playing it outside YouTube',
                   152:'YouTube refused this player',153:'YouTube refused this player'};
        var player = null, cover = document.getElementById('c'), lift = null, played = false;
        var rate = 1, lead = 0.6, lastSeek = 0, live = null;
        function now() { return Date.now() + OFFSET; }
        function hide() { if (lift) { clearTimeout(lift); lift = null; } cover.style.opacity = '1'; }
        function reveal(ms) {
          if (lift || cover.style.opacity === '0') return;
          lift = setTimeout(function () { lift = null; cover.style.opacity = '0'; }, ms);
        }
        function setRate(r) { if (rate !== r) { rate = r; try { player.setPlaybackRate(r); } catch (e) {} } }
        // A live stream: every screen just plays its live edge. A recorded video: every screen plays the
        // second it would be at if it had started with the broadcast, so they all show the same picture.
        function isLive() {
          if (live !== null) return live;
          try { var d = player.getVideoData(); if (d && typeof d.isLive === 'boolean') return (live = d.isLive); } catch (e) {}
          return !(player.getDuration() > 0);
        }
        function target(len) { return (((now() - START) / 1000) % len + len) % len; }
        function step() {
          if (!player || !player.getPlayerState) return;
          var st = player.getPlayerState();
          if (st === 2 || st === 5 || st === -1) { player.playVideo(); return; }
          if (st !== 1 || !START || isLive()) { setRate(1); return; }
          var len = player.getDuration();
          if (!(len > 0)) return;
          var want = target(len), d = player.getCurrentTime() - want;
          if (d > len / 2) d -= len; else if (d < -len / 2) d += len; // across the loop point
          var t = Date.now();
          if (t - lastSeek < 2500) return; // let the last seek settle before judging it
          if (Math.abs(d) > 1) {
            // Still off soon after a seek: this TV's seeks land late (or early) by about d; aim for that.
            if (lastSeek && t - lastSeek < 12000) lead = Math.min(5, Math.max(0, lead - d));
            lastSeek = t;
            setRate(1);
            player.seekTo((want + lead) % len, true);
            return;
          }
          if (Math.abs(d) > 0.08) setRate(d < 0 ? 1.25 : 0.75);
          else setRate(1);
        }
        function onYouTubeIframeAPIReady() {
          player = new YT.Player('p', {
            width: '100%', height: '100%', videoId: '$id',
            playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, mute: MUTED ? 1 : 0,
                          iv_load_policy: 3, fs: 0, disablekb: 1, modestbranding: 1, cc_load_policy: 0, origin: '$ORIGIN' },
            events: {
              onReady: function (e) { if (!MUTED) { e.target.unMute(); e.target.setVolume(100); } e.target.playVideo(); },
              onStateChange: function (e) {
                if (e.data === 1) {
                  Darpan.status('playing');
                  // The title YouTube shows when a video first starts fades out after about 3 s.
                  reveal(played ? 700 : 3500);
                  played = true;
                } else if (e.data === 3) {
                  if (!played) Darpan.status('loading');
                } else if (e.data === 0) {
                  // Loop ourselves: YouTube's own loop reloads the video and shows its title again.
                  hide();
                  var len = player.getDuration();
                  player.seekTo(len > 0 && START && !isLive() ? target(len) : 0, true);
                  player.playVideo();
                } else if (e.data === 2) {
                  hide(); // paused shows YouTube's buttons and suggestions: cover, and play on
                  player.playVideo();
                }
              },
              onError: function (e) { hide(); Darpan.status('error: ' + (WHY[e.data] || ('YouTube error ' + e.data))); }
            }
          });
          setInterval(step, 500);
        }
        </script>
        <script src="https://www.youtube.com/iframe_api" onerror="Darpan.status('error: cannot reach YouTube, check this TV internet')"></script>
        </body></html>
    """.trimIndent()

    private fun parseTime(s: String): Long? = try {
        iso.parse(s)?.time
    } catch (e: Exception) {
        null
    }

    private companion object {
        const val TAG = "Broadcast"
        const val ORIGIN = "https://in.kdcc.darpan"
        const val START_TIMEOUT_MS = 60_000L
        const val RETRY_MS = 15_000L
        /** Further than this from the other screens: seek (aiming a little ahead, as a seek takes time). */
        const val SEEK_GAP_MS = 1_000L
        const val SEEK_LEAD_MS = 150L
        /** Further than this: play slightly faster or slower until back in step. */
        const val STEP_GAP_MS = 60L
        const val DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        val INK = Color.rgb(20, 25, 54)
        val HALDI = Color.rgb(224, 165, 38)
        val RED = Color.rgb(196, 30, 58)
    }
}
