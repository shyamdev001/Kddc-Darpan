package `in`.kdcc.darpan

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The TV tells head office what it can do, in the shape the server reads. */
class CapabilitiesTest {
    @Test
    fun webViewVersions_giveTheirMajorNumber() {
        assertEquals(91, Capabilities.webViewMajor("91.0.4472.114"))
        assertEquals(66, Capabilities.webViewMajor(" 66.0.3359.158 "))
        assertNull(Capabilities.webViewMajor("unknown"))
        assertNull(Capabilities.webViewMajor(null))
        assertNull(Capabilities.webViewMajor("0.1"))
    }

    @Test
    fun theReport_usesTheServersFieldNames() {
        val report = CapabilityReport(
            sdk = 28,
            webView = WebViewInfo("com.google.android.webview", "91.0.4472.114", 91),
            h264Fhd = true,
            hevc = false,
            deviceOwner = true,
            brightness = null,
            network = NetworkInfo("wifi", -61),
            screenOff = null,
            videoInScreenshot = false,
            device = DeviceFacts("Xiaomi", "Xiaomi", "MiTV-MZTU0", "Mediatek MT9638", "Android 14 (API 34)"),
            display = DisplayFacts(1920, 1080, 320, 3840, 2160, 60),
            video = VideoFacts(
                avc = CodecSupport("High", "5.1", ours = true, portrait = true),
                hevc = null,
                decoders = listOf(DecoderFacts("c2.mtk.avc.decoder", "avc", hardware = true)),
            ),
            platform = "googletv",
        )
        val json = Json.parseToJsonElement(Json { encodeDefaults = true }.encodeToString(report)) as JsonObject
        assertEquals(
            setOf(
                "sdk", "webView", "h264_1080p", "hevc", "deviceOwner", "brightness", "network", "screenOff", "videoInScreenshot",
                "device", "display", "video", "platform", "reboot", "volume",
            ),
            json.keys,
        )
        assertEquals("com.google.android.webview", json["webView"]!!.jsonObject["package"]!!.jsonPrimitive.content)
        assertEquals("not known yet is sent as null, not left out", "null", json["brightness"].toString())
        assertEquals("MiTV-MZTU0", json["device"]!!.jsonObject["model"]!!.jsonPrimitive.content)
        assertEquals("true", json["video"]!!.jsonObject["avc"]!!.jsonObject["ours"].toString())
        assertEquals("null", json["video"]!!.jsonObject["hevc"].toString())
    }
}
