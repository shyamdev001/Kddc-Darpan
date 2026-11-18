package `in`.kdcc.darpan

/**
 * What to do when a video fails to play (docs/AUDIT.md, DC3). Every file on the TV has passed its
 * SHA-256 check, so downloading it again brings back the same bytes: that only helps when the file
 * could not be read. When the TV's decoder or sound output refuses it, the file is fine and this TV
 * cannot play it: skip it and tell head office, instead of downloading 40 MB again at every sync.
 */
object VideoFailure {
    /** Downloads of the same file allowed after a failure that is not the TV's decoder. */
    const val MAX_REDOWNLOADS = 1

    sealed class Action {
        object Redownload : Action()
        data class Skip(val reason: String) : Action()
    }

    /** [code] is Media3's PlaybackException.errorCode (null: no error object). Pure. */
    fun decide(code: Int?, redownloadsSoFar: Int): Action = when {
        code != null && code in 4000..5999 -> Action.Skip(reason(code)) // decoder or sound output: the TV
        redownloadsSoFar >= MAX_REDOWNLOADS -> Action.Skip("still fails after downloading it again: ${reason(code)}")
        else -> Action.Redownload
    }

    /** In head office's words. Codes from androidx.media3.common.PlaybackException. Pure. */
    fun reason(code: Int?): String = when (code) {
        4001 -> "the TV's video decoder could not start"
        4002 -> "the TV has no decoder for this video"
        4003 -> "the TV's video decoder failed while playing"
        4004 -> "the video is more than this TV can decode"
        4005 -> "this TV cannot decode this video format"
        5001 -> "the TV's sound output could not start"
        5002 -> "the TV's sound output failed"
        null -> "the video did not start"
        else -> when (code / 1000) {
            2 -> "the file could not be read"
            3 -> "the file looks damaged"
            4 -> "the TV's video decoder failed"
            5 -> "the TV's sound output failed"
            else -> "playback error $code"
        }
    }
}

/** A video this TV cannot play, for the heartbeat. */
data class Unplayable(val mediaId: String, val reason: String)
