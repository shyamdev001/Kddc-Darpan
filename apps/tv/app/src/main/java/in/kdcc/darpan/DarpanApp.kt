package `in`.kdcc.darpan

import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import kotlin.system.exitProcess

class DarpanApp : Application() {
    /** Why the app crashed lately, and whether it is in safe or rescue mode. */
    lateinit var crashes: CrashLog
        private set

    override fun onCreate() {
        super.onCreate()
        crashes = CrashLog(filesDir, BuildConfig.VERSION_CODE)
        // First, before anything else that could crash (K9): come back after a growing wait (K2)
        // instead of leaving a branch TV on the home screen, or crashing again every few seconds.
        Thread.setDefaultUncaughtExceptionHandler { _, error ->
            Log.e("DarpanApp", "Crashed; restarting", error)
            val wait = crashes.record(error, System.currentTimeMillis(), SystemClock.elapsedRealtime()) // first: the process may not get much further
            scheduleRestart(this, wait)
            exitProcess(2)
        }
        watchPlayback()
        TrustedClock.init(this)
        WatchdogReceiver.schedule(this)
    }

    /**
     * Every minute, off the main thread (a frozen main thread must not freeze this check too):
     * a picture stuck on screen during display hours restarts the app.
     */
    private fun watchPlayback() {
        val timer = java.util.Timer("darpan-pulse", true)
        timer.schedule(object : java.util.TimerTask() {
            override fun run() {
                if (!MainActivity.visible || Kiosk.inMaintenance(this@DarpanApp)) return
                val stuck = PlaybackPulse.stalledFor(SystemClock.elapsedRealtime()) ?: return
                Log.e("DarpanApp", "Playback stuck for ${stuck / 60_000} min; restarting")
                val wait = crashes.record(PlaybackStalledException(stuck / 60_000), System.currentTimeMillis(), SystemClock.elapsedRealtime())
                scheduleRestart(this@DarpanApp, wait)
                exitProcess(3)
            }
        }, 60_000L, 60_000L)
    }

    companion object {
        /** Uptime clock, not the wall clock: a TV clock corrected after a power cut must not move it (K9). */
        fun scheduleRestart(context: Context, delayMs: Long = 3_000) {
            try {
                val intent = Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                val pending = PendingIntent.getActivity(
                    context, 0, intent,
                    PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE,
                )
                val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + delayMs, pending)
            } catch (e: Throwable) {
                Log.e("DarpanApp", "Could not schedule restart", e)
            }
        }

        /** Restart the whole app (remote "restart" command). Also leaves safe and rescue mode: head office wants a fresh try. */
        fun restart(context: Context) {
            (context.applicationContext as? DarpanApp)?.crashes?.clearSafeMode()
            scheduleRestart(context, 1_500)
            exitProcess(0)
        }

        fun crashes(context: Context): CrashLog? = (context.applicationContext as? DarpanApp)?.crashes
    }
}
