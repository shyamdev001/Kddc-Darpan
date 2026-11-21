package `in`.kdcc.darpan

import android.content.Context
import android.util.Log

/**
 * Saved state across app versions (docs/AUDIT.md K10). There is no on-device database: state is
 * SharedPreferences and JSON files, read with ignoreUnknownKeys, so a removed field is harmless.
 * Two rules keep an update from losing it:
 * - every field added to a saved class gets a default value (SavedStateTest checks this), so the copy
 *   an older version saved still reads;
 * - a change that needs more than a default (a renamed key, a reshaped file) becomes a [Step] here. It
 *   runs once, on the first start of a build at or above [Step.since] after an older one, and must be
 *   safe to run twice (a power cut can stop it halfway).
 */
object AppUpgrade {
    class Step(val since: Int, val name: String, val run: (Context) -> Unit)

    /** Oldest first. None needed yet. */
    val STEPS: List<Step> = emptyList()

    /** Steps due when going from build [last] (0: never recorded) to [current]. */
    fun due(last: Int, current: Int, steps: List<Step> = STEPS): List<Step> =
        if (last >= current) emptyList() else steps.filter { it.since in (last + 1)..current }.sortedBy { it.since }

    /** Call once per process, early. A failing step is logged and skipped: never stop the app over it. */
    fun run(context: Context, prefs: Prefs) {
        val last = prefs.lastVersionCode
        val current = BuildConfig.VERSION_CODE
        if (last == current) return
        for (step in due(last, current)) {
            try {
                step.run(context)
            } catch (e: Exception) {
                Log.w("AppUpgrade", "Upgrade step ${step.name} failed", e)
            }
        }
        prefs.lastVersionCode = current
    }
}
