package `in`.kdcc.darpan

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

/**
 * The installer's answer for an update. On success Android replaces the app (this process ends and
 * BootReceiver reopens it), so mostly this records failures for the dashboard.
 */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val code = intent.getIntExtra(EXTRA_CODE, 0)
        val name = intent.getStringExtra(EXTRA_NAME) ?: code.toString()
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        Log.i(TAG, "Install result for $name: $status $message")
        when (status) {
            PackageInstaller.STATUS_SUCCESS -> Unit
            // Only happens without kiosk mode; Updater does not install then, but be safe.
            PackageInstaller.STATUS_PENDING_USER_ACTION ->
                Updater.recordFailure(context, code, "Version $name needs approval on the TV; install it by hand")
            else -> Updater.recordFailure(context, code, "Version $name failed to install: ${message ?: "error $status"}")
        }
    }

    companion object {
        private const val TAG = "UpdateReceiver"
        const val EXTRA_CODE = "versionCode"
        const val EXTRA_NAME = "versionName"
    }
}
