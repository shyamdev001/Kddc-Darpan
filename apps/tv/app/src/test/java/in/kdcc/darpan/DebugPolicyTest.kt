package `in`.kdcc.darpan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DebugPolicyTest {
    @Test
    fun lockedBranchTv_blocksDebugging() {
        assertTrue(DebugPolicy.block(owner = true, inMaintenance = false, debugBuild = false))
    }

    @Test
    fun maintenance_allowsDebugging() {
        assertFalse(DebugPolicy.block(owner = true, inMaintenance = true, debugBuild = false))
    }

    @Test
    fun notDeviceOwner_cannotBlock() {
        assertFalse(DebugPolicy.block(owner = false, inMaintenance = false, debugBuild = false))
    }

    @Test
    fun headOfficeDebugBuild_keepsAdbForInstalling() {
        assertFalse(DebugPolicy.block(owner = true, inMaintenance = false, debugBuild = true))
    }
}
