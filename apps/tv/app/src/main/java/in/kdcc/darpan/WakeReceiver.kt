package `in`.kdcc.darpan

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * The [PowerControl] alarms: the morning on-time after a night with the panel off, and the end of
 * "Test screen off". Switches the panel on and puts Darpan back in front (a device owner may start
 * its activity from the background). If the CPU was in deep standby the alarm never comes: that is
 * exactly what the test finds out.
 */
class WakeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "Wake alarm")
        intent.getStringExtra(EXTRA_TEST)?.let { PowerControl.alarmFired(context, it) }
        PowerControl.wake(context)
        Kiosk.bringToFront(context, wake = true)
    }

    companion object {
        private const val TAG = "WakeReceiver"
        const val EXTRA_TEST = "screenOffTest"
    }
}
