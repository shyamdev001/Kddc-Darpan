package `in`.kdcc.darpan

/**
 * Which Android restrictions the device owner sets, per kiosk state (docs/AUDIT.md K6). Pure, so the
 * whole table is tested on the JVM; [Kiosk.enforce] applies it and clears every managed one it leaves
 * out. Values are UserManager's DISALLOW_* keys, spelled out so the tests need no Android.
 *
 * Choices and why:
 * - Debugging (adb) is blocked while locked: anyone on the branch network could control the TV.
 *   Allowed during maintenance, in rescue mode (a crash-looping TV must stay fixable) and in debug builds.
 * - Safe boot is blocked unless in maintenance: a safe boot starts the TV without Darpan.
 * - USB file transfer and USB sticks are blocked unless in maintenance: another way to put files on
 *   the TV. A technician may need them during maintenance.
 * - Adding users is blocked whenever Darpan holds the TV: a second user is a way around the lock.
 * - Never set: factory reset (it is the last way back in, see the runbook) and installing from
 *   unknown sources (it may block our own updates on some TVs; to be checked on a real TV first).
 * - Taken out of kiosk mode (K7): nothing is set.
 */
object KioskPolicy {
    const val DEBUGGING = "no_debugging_features"
    const val SAFE_BOOT = "no_safe_boot"
    const val ADD_USER = "no_add_user"
    const val USB_FILE_TRANSFER = "no_usb_file_transfer"
    const val PHYSICAL_MEDIA = "no_physical_media"

    /** Every restriction Darpan manages; the ones not in [restrictions] are cleared. */
    val MANAGED = listOf(DEBUGGING, SAFE_BOOT, ADD_USER, USB_FILE_TRANSFER, PHYSICAL_MEDIA)

    /** Firmware updates install only in this window, TV time, minutes after midnight (01:00 to 04:00). */
    const val UPDATE_WINDOW_START_MIN = 60
    const val UPDATE_WINDOW_END_MIN = 240

    /**
     * Android's own sleep timeout (K11). Not "stay on while plugged in": outside display hours the app
     * lets the screen go, and this timeout is what turns it off; during hours the app keeps it on.
     */
    const val SCREEN_OFF_TIMEOUT_MS = 10 * 60_000

    fun restrictions(exited: Boolean, maintenance: Boolean, rescue: Boolean, debugBuild: Boolean): Set<String> {
        if (exited) return emptySet()
        val out = mutableSetOf(ADD_USER)
        if (DebugPolicy.block(owner = true, inMaintenance = maintenance, debugBuild = debugBuild, rescue = rescue)) out += DEBUGGING
        if (!maintenance) out += listOf(SAFE_BOOT, USB_FILE_TRANSFER, PHYSICAL_MEDIA)
        return out
    }
}
