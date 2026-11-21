package `in`.kdcc.darpan

/** When the app (as device owner) switches Android debugging (adb) off. */
object DebugPolicy {
    /**
     * Blocked on a locked kiosk TV running the release build. Allowed during maintenance (a technician
     * may need it), in rescue mode (a crash-looping TV must stay fixable without a factory reset, K2),
     * on TVs where the app is not device owner (it cannot), and in the debug build used for
     * head-office testing, where adb is how new builds are installed.
     */
    fun block(owner: Boolean, inMaintenance: Boolean, debugBuild: Boolean, rescue: Boolean = false): Boolean =
        owner && !inMaintenance && !debugBuild && !rescue
}
