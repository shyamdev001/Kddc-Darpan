package `in`.kdcc.darpan

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Opens Darpan when the TV powers on. On Android 10+ the system may block this unless the app
 * is the device owner (kiosk mode, see Kiosk.kt); the home-app setting covers the rest.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        // MY_PACKAGE_REPLACED: an app update (OTA) just installed; open the new version.
        if (action == Intent.ACTION_BOOT_COMPLETED || action == "android.intent.action.QUICKBOOT_POWERON" || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
