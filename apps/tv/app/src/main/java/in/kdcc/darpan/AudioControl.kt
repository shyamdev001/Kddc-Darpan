package `in`.kdcc.darpan

import android.content.Context
import android.media.AudioManager
import android.util.Log

/**
 * Volume and mute from the dashboard (docs/DEVICE_COMPATIBILITY.md, section 8), on the media stream
 * that ExoPlayer and the broadcast use. Many TVs route the speaker volume through their own
 * firmware (HDMI-CEC soundbars, "fixed volume" panels): then Android reports a fixed volume, or the
 * value does not stick, and the dashboard hides the control for that TV.
 */
object AudioControl {
    private const val TAG = "AudioControl"

    /** Percent (0-100) to a stream step (0-max), rounded. Pure. */
    fun toStep(percent: Int, max: Int): Int = if (max <= 0) 0 else ((percent.coerceIn(0, 100) * max + 50) / 100)

    /** Stream step to percent. Pure. */
    fun toPercent(step: Int, max: Int): Int = if (max <= 0) 0 else ((step.coerceIn(0, max) * 100 + max / 2) / max)

    data class State(val percent: Int, val muted: Boolean)

    private fun am(context: Context) = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    /** False for TVs whose volume Android cannot change; null until a change was tried. */
    fun supported(context: Context): Boolean? = try {
        if (am(context).isVolumeFixed) false else Capabilities.learned(context, Capabilities.KEY_VOLUME)
    } catch (e: Exception) {
        false
    }

    fun state(context: Context): State? = try {
        val am = am(context)
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        State(toPercent(am.getStreamVolume(AudioManager.STREAM_MUSIC), max), am.isStreamMute(AudioManager.STREAM_MUSIC))
    } catch (e: Exception) {
        null
    }

    /** Sets the volume; null on success, else the reason. Learns whether it stuck. */
    fun setVolume(context: Context, percent: Int): String? = change(context) { am ->
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val step = toStep(percent, max)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, step, 0)
        am.getStreamVolume(AudioManager.STREAM_MUSIC) == step
    }

    /** Mutes or unmutes the media stream; null on success, else the reason. */
    fun setMuted(context: Context, muted: Boolean): String? = change(context) { am ->
        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, if (muted) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE, 0)
        am.isStreamMute(AudioManager.STREAM_MUSIC) == muted
    }

    private fun change(context: Context, block: (AudioManager) -> Boolean): String? {
        val am = am(context)
        if (am.isVolumeFixed) {
            Capabilities.learn(context, Capabilities.KEY_VOLUME, false)
            return "This TV sets its volume itself; Android cannot change it. Use the TV remote."
        }
        return try {
            val stuck = block(am)
            Capabilities.learn(context, Capabilities.KEY_VOLUME, stuck)
            if (stuck) null else "The TV accepted the change but did not keep it; its firmware controls the volume."
        } catch (e: SecurityException) {
            // Do Not Disturb can refuse unmuting; not a TV limit as such.
            Log.w(TAG, "Volume change refused", e)
            "The TV refused the change (${e.message ?: "not allowed"})"
        } catch (e: Exception) {
            Log.w(TAG, "Volume change failed", e)
            "The TV could not change the volume"
        }
    }
}
