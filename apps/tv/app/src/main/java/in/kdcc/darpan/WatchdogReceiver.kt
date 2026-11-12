package `in`.kdcc.darpan

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log

/**
 * Every few minutes: if Darpan is not on screen in kiosk mode (killed for memory, or something
 * else opened), bring it back. Device owners may start activities from the background, so this
 * works on Android 10+. Does nothing outside kiosk mode or during maintenance.
 */
class WatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (MainActivity.visible || !Kiosk.isOwner(context) || Kiosk.inMaintenance(context)) return
        Log.i(TAG, "Darpan is not on screen; bringing it back")
        Kiosk.bringToFront(context)
    }

    companion object {
        private const val TAG = "Watchdog"
        private const val EVERY_MS = 2 * 60_000L

        /** Idempotent: the same PendingIntent replaces any earlier alarm. Alarms are lost at reboot; the app re-arms on start. */
        fun schedule(context: Context) {
            try {
                val pending = PendingIntent.getBroadcast(
                    context, 1, Intent(context, WatchdogReceiver::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                alarms.setRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + EVERY_MS, EVERY_MS, pending)
            } catch (e: Throwable) {
                Log.e(TAG, "Could not schedule the watchdog", e)
            }
        }
    }
}
