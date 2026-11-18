package `in`.kdcc.darpan

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The TV acts when the network comes back, not on every network change (OF7). */
class NetworkEdgesTest {
    @Test
    fun theNetworkThereAtStart_isNotAReturn() {
        val e = NetworkEdges<String>()
        assertFalse(e.available("lan"))
    }

    @Test
    fun cablePulledAndPluggedBack_isAReturn_once() {
        val e = NetworkEdges<String>()
        e.available("lan")
        e.lost("lan")
        assertTrue(e.available("lan"))
        assertFalse(e.available("wifi")) // a second network while one is up: nothing to do
    }

    @Test
    fun switchingFromCableToWifi_withoutAGap_isNotAReturn() {
        val e = NetworkEdges<String>()
        e.available("lan")
        e.available("wifi")
        e.lost("lan")
        assertFalse(e.available("lan"))
    }

    @Test
    fun startingWithNoNetworkAtAll_thenOneAppears() {
        val e = NetworkEdges<String>()
        e.available("wifi")
        e.lost("wifi") // the TV booted with WiFi that dropped at once
        assertTrue(e.available("wifi"))
    }
}
