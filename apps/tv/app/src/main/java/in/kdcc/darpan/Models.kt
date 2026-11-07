package `in`.kdcc.darpan

import kotlinx.serialization.Serializable

// Mirrors packages/shared/src/device-protocol.ts. Unknown fields are ignored, so the
// server can add fields without breaking TVs that are already installed.

@Serializable
data class RegisterRequest(
    val hardwareId: String,
    val model: String,
    val osVersion: String,
    val resolution: String,
    val appVersion: String,
)

@Serializable
data class RegisterResponse(
    val deviceId: String,
    val deviceToken: String,
    val pairingCode: String,
    val pairingExpiresAt: String? = null,
)

@Serializable
data class DeviceStatus(
    val paired: Boolean,
    val pairingCode: String? = null,
    val pairingExpiresAt: String? = null,
    val screenName: String? = null,
)

@Serializable
data class ManifestItem(
    val mediaId: String,
    val url: String,
    val sha256: String,
    val size: Long,
    val type: String, // "IMAGE" | "VIDEO"
    val durationSec: Int,
    val validFrom: String? = null,
    val validUntil: String? = null,
) {
    val isVideo: Boolean get() = type == "VIDEO"
}

@Serializable
data class ManifestSettings(
    val orientation: String? = null,
    val brightness: Int? = null,
    val screenOnTime: String? = null,
    val screenOffTime: String? = null,
)

@Serializable
data class Manifest(
    val version: String,
    val generatedAt: String? = null,
    val items: List<ManifestItem> = emptyList(),
    val settings: ManifestSettings = ManifestSettings(),
)
