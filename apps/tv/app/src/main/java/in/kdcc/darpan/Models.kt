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

/** When a timed playlist plays (India time). Empty days = every day; null = no limit. */
@Serializable
data class TimeSlot(
    val days: List<Int> = emptyList(), // 0 = Sunday
    val start: String? = null, // "HH:mm"
    val end: String? = null,
    val fromDate: String? = null, // "YYYY-MM-DD"
    val toDate: String? = null,
)

/** When the screen is on. Outside these hours the TV shows black. */
@Serializable
data class DisplayHours(
    val days: List<Int> = emptyList(),
    val on: String,
    val off: String,
    val closedSaturdays: List<Int> = emptyList(), // e.g. 2nd and 4th
    val brightness: Int? = null, // percent while on; null = leave the TV's own setting
)

@Serializable
data class PlaylistEntry(
    val mediaId: String,
    val durationSec: Int,
)

@Serializable
data class ManifestPlaylist(
    val id: String,
    val name: String = "",
    val slots: List<TimeSlot> = emptyList(), // empty = always
    val items: List<PlaylistEntry> = emptyList(),
)

@Serializable
data class ManifestSettings(
    val orientation: String? = null,
    val hours: DisplayHours? = null,
)

@Serializable
data class Manifest(
    val version: String,
    val generatedAt: String? = null,
    /** Every file to download and keep. */
    val items: List<ManifestItem> = emptyList(),
    /** Most important first: play the first one whose slots match now. */
    val playlists: List<ManifestPlaylist> = emptyList(),
    val settings: ManifestSettings = ManifestSettings(),
    /** A newer app build offered to this TV, if any. */
    val app: ManifestApp? = null,
    /** Shown instead of the playlists until it ends. */
    val broadcast: ManifestBroadcast? = null,
)

/** An urgent message, poster or video, or live stream from head office. */
@Serializable
data class ManifestBroadcast(
    val id: String,
    val kind: String, // MESSAGE | MEDIA | LINK
    val title: String? = null,
    val message: String? = null,
    val media: ManifestItem? = null,
    val link: BroadcastLink? = null,
    val muted: Boolean = false,
    val endsAt: String? = null, // ISO; null = until stopped
)

@Serializable
data class BroadcastLink(
    val type: String, // youtube | stream
    val youtubeId: String? = null,
    val url: String? = null,
)

@Serializable
data class ManifestApp(
    val versionCode: Int,
    val versionName: String,
    val url: String,
    val sha256: String,
    val size: Long,
)
