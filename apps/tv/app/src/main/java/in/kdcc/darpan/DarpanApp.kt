package `in`.kdcc.darpan

import android.app.AlarmManager
import android.app.Application
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlin.system.exitProcess

class DarpanApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // If anything crashes, come back in a few seconds instead of leaving a branch TV on the home screen.
        Thread.setDefaultUncaughtExceptionHandler { _, error ->
            Log.e("DarpanApp", "Crashed; restarting", error)
            scheduleRestart(this)
            exitProcess(2)
        }
    }

    companion object {
        fun scheduleRestart(context: Context, delayMs: Long = 3_000) {
            try {
                val intent = Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                val pending = PendingIntent.getActivity(
                    context, 0, intent,
                    PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE,
                )
                val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                alarms.set(AlarmManager.RTC, System.currentTimeMillis() + delayMs, pending)
            } catch (e: Throwable) {
                Log.e("DarpanApp", "Could not schedule restart", e)
            }
        }

        /** Restart the whole app (remote "restart" command). */
        fun restart(context: Context) {
            scheduleRestart(context, 1_500)
            exitProcess(0)
        }
    }
}
