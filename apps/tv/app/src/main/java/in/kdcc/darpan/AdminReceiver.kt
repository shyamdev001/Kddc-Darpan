package `in`.kdcc.darpan

import android.app.admin.DeviceAdminReceiver

/**
 * Lets this app become the TV's device owner, which kiosk mode needs. Set once over adb:
 * `adb shell dpm set-device-owner in.kdcc.darpan/.AdminReceiver` (see README).
 */
class AdminReceiver : DeviceAdminReceiver()
