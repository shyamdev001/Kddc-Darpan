package `in`.kdcc.darpan

import android.os.UserManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class KioskPolicyTest {
    private fun r(exited: Boolean = false, maintenance: Boolean = false, rescue: Boolean = false, debugBuild: Boolean = false) =
        KioskPolicy.restrictions(exited, maintenance, rescue, debugBuild)

    @Test
    fun keys_areAndroidsOwn() {
        // Compile-time constants, so this runs without Android.
        assertEquals(UserManager.DISALLOW_DEBUGGING_FEATURES, KioskPolicy.DEBUGGING)
        assertEquals(UserManager.DISALLOW_SAFE_BOOT, KioskPolicy.SAFE_BOOT)
        assertEquals(UserManager.DISALLOW_ADD_USER, KioskPolicy.ADD_USER)
        assertEquals(UserManager.DISALLOW_USB_FILE_TRANSFER, KioskPolicy.USB_FILE_TRANSFER)
        assertEquals(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA, KioskPolicy.PHYSICAL_MEDIA)
    }

    @Test
    fun locked_blocksEveryWayAround() {
        assertEquals(KioskPolicy.MANAGED.toSet(), r())
    }

    @Test
    fun maintenance_opensDebuggingUsbAndSafeBoot_butNotNewUsers() {
        assertEquals(setOf(KioskPolicy.ADD_USER), r(maintenance = true))
    }

    @Test
    fun rescue_allowsAdbOnly() {
        assertEquals(KioskPolicy.MANAGED.toSet() - KioskPolicy.DEBUGGING, r(rescue = true))
    }

    @Test
    fun debugBuild_keepsAdb() {
        assertTrue(KioskPolicy.DEBUGGING !in r(debugBuild = true))
    }

    @Test
    fun exited_setsNothing() {
        assertEquals(emptySet<String>(), r(exited = true))
        assertEquals(emptySet<String>(), r(exited = true, maintenance = true, rescue = true))
    }

    @Test
    fun factoryReset_isNeverAmongThem() {
        // The last way back into a TV (runbook, safety rule 3).
        assertTrue("no_factory_reset" !in KioskPolicy.MANAGED)
        assertTrue("no_install_unknown_sources" !in KioskPolicy.MANAGED)
    }

    @Test
    fun updateWindow_isAtNight() {
        assertEquals(60, KioskPolicy.UPDATE_WINDOW_START_MIN)
        assertEquals(240, KioskPolicy.UPDATE_WINDOW_END_MIN)
    }
}
