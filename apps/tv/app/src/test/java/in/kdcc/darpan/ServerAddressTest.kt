package `in`.kdcc.darpan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerAddressTest {
    @Test
    fun release_acceptsOnlyHttps() {
        assertEquals("https://signage.example.com", ServerAddress.normalize(" https://signage.example.com/ ", allowHttp = false))
        assertEquals("https://signage.example.com", ServerAddress.normalize("signage.example.com", allowHttp = false))
        assertNull(ServerAddress.normalize("http://signage.example.com", allowHttp = false))
        assertNull(ServerAddress.normalize("http://10.0.0.5:4000", allowHttp = false))
    }

    @Test
    fun debug_alsoAcceptsALanLaptopOverHttp() {
        assertEquals("http://10.0.0.5:4000", ServerAddress.normalize("10.0.0.5:4000", allowHttp = true))
        assertEquals("https://signage.example.com", ServerAddress.normalize("https://signage.example.com", allowHttp = true))
    }

    @Test
    fun rejectsWhatIsNotAnAddress() {
        for (bad in listOf("", "https://", "http://", "https://bad host", "https://x.test/path", "ftp://x.test")) {
            assertNull(bad, ServerAddress.normalize(bad, allowHttp = true))
        }
    }
}
