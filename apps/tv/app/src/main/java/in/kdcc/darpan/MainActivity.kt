package `in`.kdcc.darpan

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * The only screen. States: setup (server address) -> pairing (shows code) -> live (plays content).
 * Once paired, the TV plays its last saved manifest straight away, even with no network.
 */
class MainActivity : Activity(), DeviceLink.Listener {
    private val scope = MainScope()
    private val syncLock = Mutex()

    private lateinit var prefs: Prefs
    private lateinit var api: Api
    private lateinit var cache: MediaCache
    private lateinit var store: ManifestStore
    private lateinit var plays: PlayLogStore
    private lateinit var playback: Playback

    private lateinit var root: FrameLayout
    private lateinit var stage: FrameLayout
    private lateinit var idlePanel: View
    private lateinit var idleDetail: TextView
    private lateinit var pairPanel: View
    private lateinit var pairCode: TextView
    private lateinit var pairStatus: TextView
    private lateinit var setupPanel: View
    private lateinit var serverInput: EditText
    private lateinit var connectButton: Button
    private lateinit var setupMessage: TextView

    private var flow: Job? = null
    private var periodic: Job? = null
    private var playUploads: Job? = null
    private var link: DeviceLink? = null
    private var manifestVersion: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        stage = findViewById(R.id.stage)
        idlePanel = findViewById(R.id.idlePanel)
        idleDetail = findViewById(R.id.idleDetail)
        pairPanel = findViewById(R.id.pairPanel)
        pairCode = findViewById(R.id.pairCode)
        pairStatus = findViewById(R.id.pairStatus)
        setupPanel = findViewById(R.id.setupPanel)
        serverInput = findViewById(R.id.serverInput)
        connectButton = findViewById(R.id.connectButton)
        setupMessage = findViewById(R.id.setupMessage)

        prefs = Prefs(this)
        api = Api(prefs)
        cache = MediaCache(filesDir, api.http, prefs)
        store = ManifestStore(filesDir)
        plays = PlayLogStore(filesDir)
        playback = Playback(
            this,
            findViewById<ImageView>(R.id.imageA),
            findViewById<ImageView>(R.id.imageB),
            findViewById<PlayerView>(R.id.video),
            cache,
            plays,
            scope,
            onState = { state -> onPlayState(state) },
            onIdleReason = { reason -> idleDetail.text = reason },
        )

        findViewById<Button>(R.id.changeServer).setOnClickListener { showSetup(null) }
        connectButton.setOnClickListener { saveServer() }
        serverInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                saveServer()
                true
            } else {
                false
            }
        }

        if (prefs.serverUrl.isBlank()) showSetup(null) else begin()
        scope.launch { kioskLoop() }
    }

    override fun onStart() {
        super.onStart()
        visible = true
    }

    override fun onResume() {
        super.onResume()
        Kiosk.enforce(this)
    }

    override fun onStop() {
        visible = false
        super.onStop()
    }

    /** Ends maintenance on time and keeps the app pinned; tells the dashboard when the state changes. */
    private suspend fun kioskLoop() {
        var last = Kiosk.state(this)
        while (scope.isActive) {
            delay(30_000)
            if (Kiosk.isOwner(this) && !Kiosk.inMaintenance(this)) {
                if (visible) Kiosk.enforce(this) else Kiosk.bringToFront(this)
            }
            val now = Kiosk.state(this)
            if (now != last) {
                last = now
                link?.sendHeartbeat()
            }
        }
    }

    /**
     * The TV's own settings (Wi-Fi, display). In kiosk mode they open only during maintenance:
     * started from the dashboard, or right here when the TV cannot reach the server (a changed
     * Wi-Fi password must be fixable at the branch).
     */
    private fun openTvSettings() {
        if (Kiosk.isOwner(this) && !Kiosk.inMaintenance(this)) {
            if (link?.connected == true) {
                Toast.makeText(this, getString(R.string.kiosk_locked), Toast.LENGTH_LONG).show()
                return
            }
            Kiosk.startMaintenance(this)
            link?.sendHeartbeat()
            Toast.makeText(this, getString(R.string.kiosk_offline_unlock), Toast.LENGTH_LONG).show()
        }
        try {
            startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            Log.w(TAG, "No settings screen on this TV", e)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Deprecated("Back is ignored while playing so a stray remote press does not exit the signage.")
    override fun onBackPressed() {
        if (setupPanel.visibility == View.VISIBLE && prefs.serverUrl.isNotBlank()) {
            setupPanel.visibility = View.GONE
            begin()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            if (pairPanel.visibility == View.VISIBLE) {
                // Before pairing: server setup.
                showSetup(null)
            } else {
                // On the server screen or while live: the TV's own settings (Wi-Fi, display).
                openTvSettings()
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        stopLive()
        playback.release()
        scope.cancel()
        super.onDestroy()
    }

    // ---------- Flow ----------

    private fun begin() {
        flow?.cancel()
        flow = scope.launch {
            if (prefs.deviceToken != null && prefs.paired) {
                // Offline first: put the last known content on screen before touching the network.
                store.load()?.let { raw ->
                    try {
                        applyManifest(api.parseManifest(raw))
                    } catch (e: Exception) {
                        Log.w(TAG, "Saved manifest unreadable", e)
                    }
                }
                goLive()
            } else {
                pair()
            }
        }
    }

    private suspend fun pair() {
        stopLive()
        playback.stop()
        showPairing(null, getString(R.string.pair_waiting))
        var backoff = 5_000L
        while (scope.isActive) {
            try {
                if (prefs.deviceToken == null) {
                    val r = api.register(
                        RegisterRequest(
                            hardwareId = prefs.hardwareId(),
                            model = "${Build.MANUFACTURER} ${Build.MODEL}".take(120),
                            osVersion = "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})".take(60),
                            resolution = resolution(),
                            appVersion = BuildConfig.VERSION_NAME,
                        ),
                    )
                    prefs.saveDevice(r.deviceId, r.deviceToken)
                    showPairing(r.pairingCode, null)
                }
                val s = api.status()
                if (s.paired) {
                    prefs.paired = true
                    goLive()
                    return
                }
                showPairing(s.pairingCode, null)
                backoff = 5_000L
                delay(5_000)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.code == 401) {
                    prefs.clearDevice() // token unknown to the server: register again
                    continue
                }
                showPairing(null, "The server replied with an error (${e.code}). Retrying…")
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(60_000)
            } catch (e: Exception) {
                showPairing(null, "Cannot reach ${prefs.serverUrl}. Retrying…")
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(60_000)
            }
        }
    }

    private fun goLive() {
        pairPanel.visibility = View.GONE
        setupPanel.visibility = View.GONE
        stopLive()
        val token = prefs.deviceToken ?: return begin()
        link = DeviceLink(prefs.serverUrl, token, this).also { it.connect() }
        // The socket pushes changes; this is the safety net if a push is missed.
        periodic = scope.launch {
            while (isActive) {
                sync()
                delay(SYNC_EVERY_MS)
            }
        }
        playUploads = scope.launch {
            delay(PLAYLOG_FIRST_MS)
            while (isActive) {
                uploadPlays()
                delay(PLAYLOG_EVERY_MS)
            }
        }
    }

    /** Sends saved play logs in batches; whatever fails stays saved for the next hour. */
    private suspend fun uploadPlays() {
        try {
            while (true) {
                val lines = withContext(Dispatchers.IO) { plays.pending(PLAYLOG_BATCH) }
                if (lines.isEmpty()) return
                // A line cut short by a power cut would spoil the batch; skip it.
                val good = lines.filter { runCatching { JSONObject(it) }.isSuccess }
                if (good.isNotEmpty()) {
                    try {
                        api.uploadPlayLogs("{\"entries\":[" + good.joinToString(",") + "]}")
                    } catch (e: ApiException) {
                        if (e.code != 400) throw e
                        Log.w(TAG, "Server refused a play log batch; dropping it: ${e.message}")
                    }
                }
                withContext(Dispatchers.IO) { plays.drop(lines.size) }
                if (lines.size < PLAYLOG_BATCH) return
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Play log upload failed; will retry", e)
        }
    }

    private fun stopLive() {
        link?.close()
        link = null
        periodic?.cancel()
        periodic = null
        playUploads?.cancel()
        playUploads = null
    }

    /** Fetch the manifest, start showing it, then download anything missing. True if the fetch worked. */
    private suspend fun sync(): Boolean = syncLock.withLock {
        try {
            val raw = api.manifestRaw()
            val m = api.parseManifest(raw)
            withContext(Dispatchers.IO) { store.save(raw) }
            applyManifest(m)
            withContext(Dispatchers.IO) { downloadAll(m) }
            link?.sendHeartbeat()
            return@withLock true
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            when (e.code) {
                401 -> onUnauthorized()
                403 -> { // server says not paired (TV was reset elsewhere): show a code again
                    prefs.paired = false
                    begin()
                }
                else -> Log.w(TAG, "Sync failed (${e.code}); still playing the last content")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Sync failed; still playing the last content", e)
        }
        false
    }

    private suspend fun downloadAll(m: Manifest) {
        for (item in m.items.distinctBy { it.sha256 }) {
            if (cache.has(item)) continue
            for (attempt in 1..3) {
                val done = try {
                    cache.download(item)
                } catch (e: ApiException) {
                    if (e.code == 401) throw e
                    Log.w(TAG, "Download ${item.mediaId} failed: ${e.code}")
                    false
                } catch (e: IOException) {
                    Log.w(TAG, "Download ${item.mediaId} interrupted; will resume", e)
                    false
                }
                if (done) break
                delay(3_000L * attempt)
            }
        }
        cache.cleanup(m.items.map { it.sha256 }.toSet())
    }

    private fun applyManifest(m: Manifest) {
        // The server's clock, even from a saved manifest, beats a TV clock reset by a power cut.
        m.generatedAt?.let { parseIso(it) }?.let { TrustedClock.serverTime(it) }
        manifestVersion = m.version
        applyOrientation(m.settings.orientation == "PORTRAIT")
        playback.setManifest(m)
    }

    /**
     * Outside display hours the screen is black and may sleep (the TV's own power saving can take
     * over); during hours it is kept awake. The "nothing to play" panel shows only in hours.
     */
    private fun onPlayState(state: PlayState) {
        idlePanel.visibility = if (state == PlayState.NOTHING) View.VISIBLE else View.GONE
        if (state == PlayState.OFF_HOURS) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    /** Portrait-mounted TVs: lay the stage out tall and turn it a quarter turn. */
    private fun applyOrientation(portrait: Boolean) {
        root.post {
            val w = root.width
            val h = root.height
            if (w == 0 || h == 0) return@post
            val lp = stage.layoutParams as FrameLayout.LayoutParams
            if (portrait) {
                lp.width = h
                lp.height = w
                stage.rotation = 90f
            } else {
                lp.width = ViewGroup.LayoutParams.MATCH_PARENT
                lp.height = ViewGroup.LayoutParams.MATCH_PARENT
                stage.rotation = 0f
            }
            lp.gravity = Gravity.CENTER
            stage.layoutParams = lp
        }
    }

    // ---------- DeviceLink.Listener ----------

    override fun onManifestUpdated(version: String) {
        if (version != manifestVersion) scope.launch { sync() }
    }

    override fun onCommand(commandId: String, type: String) {
        val l = link
        when (type) {
            "reload" -> scope.launch {
                val ok = sync()
                l?.sendAck(commandId, ok, if (ok) null else "Could not fetch the playlist from the server")
            }
            "restart" -> scope.launch {
                l?.sendAck(commandId, true) // reply first: the restart cuts the connection
                delay(800)
                DarpanApp.restart(this@MainActivity)
            }
            "clearCache" -> scope.launch {
                withContext(Dispatchers.IO) { cache.clearAll() }
                val ok = sync()
                l?.sendAck(commandId, ok, if (ok) null else "Files cleared, but the new download could not start")
            }
            "screenshot" -> scope.launch {
                val jpeg = Screenshot.capture(this@MainActivity)
                if (jpeg == null) {
                    l?.sendAck(commandId, false, "The TV could not read its screen")
                    return@launch
                }
                try {
                    api.uploadScreenshot(commandId, jpeg) // the server records the reply on upload
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Screenshot upload failed", e)
                    l?.sendAck(commandId, false, "Upload failed: ${e.message ?: "network error"}")
                }
            }
            "kioskUnlock" -> {
                val ok = Kiosk.startMaintenance(this)
                l?.sendAck(commandId, ok, if (ok) null else "Kiosk mode is not set up on this TV")
                l?.sendHeartbeat()
            }
            "kioskLock" -> {
                val ok = Kiosk.endMaintenance(this)
                l?.sendAck(commandId, ok, if (ok) null else "Kiosk mode is not set up on this TV")
                l?.sendHeartbeat()
            }
            else -> {
                Log.i(TAG, "Command not supported: $type")
                l?.sendAck(commandId, false, "This app version does not support \"$type\"")
            }
        }
    }

    override fun onUnauthorized() {
        // Removed from the dashboard: stop showing content and ask to be paired again.
        stopLive()
        playback.stop()
        store.clear()
        manifestVersion = null
        prefs.clearDevice()
        begin()
    }

    override fun onServerDisconnect() {
        scope.launch {
            try {
                api.status()
                delay(5_000)
                link?.reconnect()
            } catch (e: ApiException) {
                if (e.code == 401) onUnauthorized() else link?.reconnect()
            } catch (e: Exception) {
                link?.reconnect()
            }
        }
    }

    override fun heartbeat(): JSONObject {
        val mem = ActivityManager.MemoryInfo()
        (getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mem)
        return JSONObject()
            .put("currentMediaId", playback.currentMediaId ?: JSONObject.NULL)
            .put("storageFreeBytes", cache.dir.usableSpace)
            .put("storageTotalBytes", cache.dir.totalSpace)
            .put("ramFreeBytes", mem.availMem)
            .put("ramTotalBytes", mem.totalMem)
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("manifestVersion", manifestVersion ?: "")
            .put("kiosk", Kiosk.state(this))
            .put("kioskUntil", Kiosk.maintenanceEndsAt(this)?.let { iso(it) } ?: JSONObject.NULL)
    }

    // ---------- Screens ----------

    private fun showPairing(code: String?, status: String?) {
        setupPanel.visibility = View.GONE
        idlePanel.visibility = View.GONE
        pairPanel.visibility = View.VISIBLE
        if (code != null) pairCode.text = "${code.take(3)} ${code.drop(3)}"
        pairStatus.text = status ?: "Server: ${prefs.serverUrl}"
    }

    private fun showSetup(message: String?) {
        flow?.cancel()
        stopLive()
        pairPanel.visibility = View.GONE
        setupPanel.visibility = View.VISIBLE
        serverInput.setText(prefs.serverUrl.ifBlank { "http://" })
        serverInput.setSelection(serverInput.text.length)
        serverInput.requestFocus()
        setupMessage.text = message ?: ""
    }

    private fun saveServer() {
        val url = normalizeUrl(serverInput.text.toString())
        if (url == null) {
            setupMessage.text = getString(R.string.setup_hint)
            return
        }
        connectButton.isEnabled = false
        setupMessage.text = "Checking $url …"
        scope.launch {
            val ok = api.checkHealth(url)
            connectButton.isEnabled = true
            if (!ok) {
                setupMessage.text = "Could not reach $url. Check the address, and that the TV and the server are on the same network."
                return@launch
            }
            if (url != prefs.serverUrl) {
                // A token from another server is useless here.
                prefs.clearDevice()
                store.clear()
            }
            prefs.serverUrl = url
            (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .hideSoftInputFromWindow(serverInput.windowToken, 0)
            setupPanel.visibility = View.GONE
            begin()
        }
    }

    private fun parseIso(s: String): Long? = try {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(s)?.time
    } catch (e: Exception) {
        null
    }

    private fun normalizeUrl(input: String): String? {
        var s = input.trim().trimEnd('/')
        if (s.isEmpty() || s == "http:" || s == "http://") return null
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
        return if (Regex("^https?://[^\\s/]+(:\\d+)?$").matches(s)) s else null
    }

    @Suppress("DEPRECATION")
    private fun resolution(): String {
        val dm = DisplayMetrics()
        windowManager.defaultDisplay.getRealMetrics(dm)
        return "${maxOf(dm.widthPixels, dm.heightPixels)}x${minOf(dm.widthPixels, dm.heightPixels)}"
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
    }

    private fun iso(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(ms)

    companion object {
        /** True while the activity is on screen; read by the watchdog. */
        @Volatile
        var visible = false
            private set

        private const val TAG = "Darpan"
        private const val SYNC_EVERY_MS = 10 * 60_000L
        private const val PLAYLOG_FIRST_MS = 2 * 60_000L
        private const val PLAYLOG_EVERY_MS = 60 * 60_000L
        private const val PLAYLOG_BATCH = 500
    }
}
