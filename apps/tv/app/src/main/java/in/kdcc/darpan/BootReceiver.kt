package `in`.kdcc.darpan

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Opens Darpan when the TV powers on. On Android 10+ the system may block this unless the app
 * is the device owner (kiosk mode, Phase 2).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED || action == "android.intent.action.QUICKBOOT_POWERON") {
            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
