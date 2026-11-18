package `in`.kdcc.darpan

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** An HTTP error from the server. 401 means the device token is no longer valid. */
class ApiException(val code: Int, message: String) : IOException(message)

/**
 * A web page answered instead of our server: a hotel-style WiFi sign-in page or a bank proxy's
 * block page (docs/AUDIT.md, OF8). Our server never answers with HTML, so this is never a lost key,
 * even when the page came with 401 or 403.
 */
class SignInPageException : IOException("a network sign-in or proxy page answered instead of the server")

/** True for an HTML reply. */
fun isWebPage(contentType: String?): Boolean =
    contentType?.substringBefore(';')?.trim()?.equals("text/html", ignoreCase = true) == true

class Api(private val prefs: Prefs) {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val json = Json { ignoreUnknownKeys = true }
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun url(path: String): String = prefs.serverUrl.trimEnd('/') + path

    suspend fun register(body: RegisterRequest): RegisterResponse = withContext(Dispatchers.IO) {
        val text = json.encodeToString(RegisterRequest.serializer(), body)
        val req = Request.Builder().url(url("/api/devices/register")).post(text.toRequestBody(jsonType)).build()
        json.decodeFromString(RegisterResponse.serializer(), call(req))
    }

    /** Pairing state; `token` defaults to the TV's own key (a waiting new key can be checked too). */
    suspend fun status(token: String? = prefs.deviceToken): DeviceStatus = withContext(Dispatchers.IO) {
        json.decodeFromString(DeviceStatus.serializer(), call(authed("/api/devices/status", token)))
    }

    /** Raw JSON, so exactly what the server sent can be saved for offline use. */
    suspend fun manifestRaw(): String = withContext(Dispatchers.IO) { call(authed("/api/devices/manifest")) }

    fun parseManifest(raw: String): Manifest = json.decodeFromString(Manifest.serializer(), raw)

    /** Uploads a JPEG screenshot for a `screenshot` command. */
    suspend fun uploadScreenshot(commandId: String, jpeg: ByteArray) = withContext(Dispatchers.IO) {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", "screen.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()
        val req = Request.Builder().url(url("/api/devices/commands/$commandId/screenshot"))
            .header("Authorization", "Bearer ${prefs.deviceToken ?: ""}")
            .post(body)
            .build()
        call(req)
    }

    /** Proof of play: `body` is a ready-made {"entries":[...]} batch. */
    suspend fun uploadPlayLogs(body: String) = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url("/api/devices/playlogs"))
            .header("Authorization", "Bearer ${prefs.deviceToken ?: ""}")
            .post(body.toRequestBody(jsonType))
            .build()
        call(req)
    }

    /** True when `baseUrl` answers /api/health; used by the setup screen. */
    suspend fun checkHealth(baseUrl: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val quick = http.newBuilder().callTimeout(6, TimeUnit.SECONDS).build()
            quick.newCall(Request.Builder().url(baseUrl.trimEnd('/') + "/api/health").build()).execute().use { it.isSuccessful }
        } catch (e: Exception) {
            false
        }
    }

    private fun authed(path: String, token: String? = prefs.deviceToken): Request =
        Request.Builder().url(url(path)).header("Authorization", "Bearer ${token ?: ""}").build()

    private fun call(req: Request): String {
        http.newCall(req).execute().use { res ->
            if (isWebPage(res.header("Content-Type"))) throw SignInPageException()
            val text = res.body?.string() ?: ""
            if (!res.isSuccessful) throw ApiException(res.code, text.take(200))
            return text
        }
    }
}
