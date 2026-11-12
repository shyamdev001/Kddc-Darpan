package `in`.kdcc.darpan

import android.os.Handler
import android.os.Looper
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.emitter.Emitter
import io.socket.engineio.client.transports.WebSocket
import org.json.JSONObject
import java.net.URI

/**
 * Live connection to the server (Socket.IO namespace /devices). Receives `manifest:updated` and
 * `command`, sends a heartbeat every 60 s. Reconnects on its own after network drops.
 * All listener calls are delivered on the main thread.
 */
class DeviceLink(
    private val serverUrl: String,
    private val token: String,
    private val listener: Listener,
) {
    interface Listener {
        fun onManifestUpdated(version: String)
        /** A remote command; reply with [sendAck] (a screenshot replies by uploading). */
        fun onCommand(commandId: String, type: String)
        /** The server no longer knows this token (screen removed or TV re-registered elsewhere). */
        fun onUnauthorized()
        /** The server closed the connection on purpose; check whether we are still allowed in. */
        fun onServerDisconnect()
        fun heartbeat(): JSONObject
    }

    private val main = Handler(Looper.getMainLooper())
    private var socket: Socket? = null
    private var closed = false

    private val beat = object : Runnable {
        override fun run() {
            sendHeartbeat()
            main.postDelayed(this, HEARTBEAT_MS)
        }
    }

    fun connect() {
        val options = IO.Options.builder()
            .setAuth(mapOf("token" to token))
            .setTransports(arrayOf(WebSocket.NAME))
            .setReconnection(true)
            .setReconnectionDelay(2_000)
            .setReconnectionDelayMax(60_000)
            .build()
        val s = IO.socket(URI.create(serverUrl.trimEnd('/') + "/devices"), options)

        s.on(Socket.EVENT_CONNECT, Emitter.Listener {
            main.post { sendHeartbeat() }
        })
        s.on("manifest:updated", Emitter.Listener { args ->
            val version = (args.firstOrNull() as? JSONObject)?.optString("version") ?: ""
            main.post { if (!closed) listener.onManifestUpdated(version) }
        })
        s.on("command", Emitter.Listener { args ->
            val data = args.firstOrNull() as? JSONObject
            val id = data?.optString("commandId") ?: ""
            val type = data?.optString("type") ?: ""
            main.post { if (!closed) listener.onCommand(id, type) }
        })
        s.on(Socket.EVENT_CONNECT_ERROR, Emitter.Listener { args ->
            val message = when (val a = args.firstOrNull()) {
                is JSONObject -> a.optString("message")
                is Throwable -> a.message ?: ""
                else -> a?.toString() ?: ""
            }
            Log.w(TAG, "connect error: $message")
            main.post {
                if (closed) return@post
                if (message == "unauthorized") {
                    listener.onUnauthorized()
                } else {
                    // Errors from the server's handshake are not retried by the library; retry ourselves.
                    main.postDelayed({ if (!closed && !s.connected()) s.connect() }, RETRY_MS)
                }
            }
        })
        s.on(Socket.EVENT_DISCONNECT, Emitter.Listener { args ->
            val reason = args.firstOrNull()?.toString() ?: ""
            Log.i(TAG, "disconnected: $reason")
            if (reason == "io server disconnect") main.post { if (!closed) listener.onServerDisconnect() }
        })

        socket = s
        s.connect()
        main.postDelayed(beat, HEARTBEAT_MS)
    }

    fun reconnect() {
        socket?.let { if (!it.connected()) it.connect() }
    }

    fun sendHeartbeat() {
        val s = socket ?: return
        if (!s.connected()) return
        try {
            s.emit("heartbeat", listener.heartbeat())
        } catch (e: Exception) {
            Log.w(TAG, "heartbeat failed", e)
        }
    }

    fun sendAck(commandId: String, ok: Boolean, error: String? = null) {
        val s = socket ?: return
        if (commandId.isEmpty() || !s.connected()) return
        val body = JSONObject().put("commandId", commandId).put("ok", ok)
        if (error != null) body.put("error", error.take(200))
        s.emit("command:ack", body)
    }

    fun close() {
        closed = true
        main.removeCallbacks(beat)
        socket?.off()
        socket?.disconnect()
        socket = null
    }

    private companion object {
        const val TAG = "DeviceLink"
        const val HEARTBEAT_MS = 60_000L
        const val RETRY_MS = 30_000L
    }
}
