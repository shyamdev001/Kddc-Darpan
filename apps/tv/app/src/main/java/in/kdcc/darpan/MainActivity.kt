package `in`.kdcc.darpan

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
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
        playback = Playback(
            this,
            findViewById<ImageView>(R.id.imageA),
            findViewById<ImageView>(R.id.imageB),
            findViewById<PlayerView>(R.id.video),
            cache,
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
        // Menu/Settings on the remote opens server setup, but only before the TV is paired.
        if ((keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) && pairPanel.visibility == View.VISIBLE) {
            showSetup(null)
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
    }

    private fun stopLive() {
        link?.close()
        link = null
        periodic?.cancel()
        periodic = null
    }

    /** Fetch the manifest, start showing it, then download anything missing. */
    private suspend fun sync() = syncLock.withLock {
        try {
            val raw = api.manifestRaw()
            val m = api.parseManifest(raw)
            withContext(Dispatchers.IO) { store.save(raw) }
            applyManifest(m)
            withContext(Dispatchers.IO) { downloadAll(m) }
            link?.sendHeartbeat()
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

    override fun onCommand(type: String) {
        when (type) {
            "reload" -> scope.launch { sync() }
            "restart" -> DarpanApp.restart(this)
            "clearCache" -> scope.launch {
                withContext(Dispatchers.IO) { cache.clearAll() }
                sync()
            }
            else -> Log.i(TAG, "Command not supported yet: $type")
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

    private companion object {
        const val TAG = "Darpan"
        const val SYNC_EVERY_MS = 10 * 60_000L
    }
}
