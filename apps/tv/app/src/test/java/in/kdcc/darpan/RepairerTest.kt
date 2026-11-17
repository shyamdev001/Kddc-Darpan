package `in`.kdcc.darpan

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException

/** A refused key never blanks the screen: the TV gets a new code in a corner, or finds its old key works again. */
class RepairerTest {
    private var pending: String? = null
    private val shown = mutableListOf<String?>()
    private var registrations = 0

    private fun repairer(
        oldKeyWorks: suspend () -> Boolean = { false },
        statusWith: suspend (String) -> DeviceStatus,
    ) = Repairer(
        oldKeyWorks = oldKeyWorks,
        register = {
            registrations++
            RegisterResponse(deviceId = "screen-1", deviceToken = "new-key-$registrations", pairingCode = "12345$registrations")
        },
        statusWith = statusWith,
        pendingToken = { pending },
        savePending = { pending = it.deviceToken },
        dropPending = { pending = null },
        showCode = { shown += it },
        pollMs = 1,
        maxBackoffMs = 4,
    )

    @Test
    fun keyRefused_showsANewCode_untilHeadOfficeEntersIt() = runBlocking {
        var polls = 0
        val r = repairer(statusWith = { token ->
            assertEquals("new-key-1", token)
            polls++
            if (polls < 3) DeviceStatus(paired = false, pairingCode = "123451") else DeviceStatus(paired = true)
        })
        assertEquals(Repairer.Outcome.NEW_KEY_PAIRED, withTimeout(5_000) { r.run() })
        assertEquals("123451", shown.first())
        assertNull("the corner code is hidden once paired", shown.last())
        assertEquals(1, registrations)
        assertEquals("new-key-1", pending) // MainActivity then makes this the TV's key
    }

    @Test
    fun oldKeyWorksAgain_noNewPairingNeeded() = runBlocking {
        var checks = 0
        val r = repairer(oldKeyWorks = { ++checks >= 2 }, statusWith = { DeviceStatus(paired = false, pairingCode = "123451") })
        assertEquals(Repairer.Outcome.OLD_KEY_WORKS, withTimeout(5_000) { r.run() })
        assertNull(pending)
        assertNull(shown.last())
    }

    @Test
    fun noNetwork_keepsTrying_withoutGivingUp() = runBlocking {
        var tries = 0
        val r = repairer(oldKeyWorks = { if (++tries < 4) throw IOException("no network") else true }, statusWith = { error("not reached") })
        assertEquals(Repairer.Outcome.OLD_KEY_WORKS, withTimeout(5_000) { r.run() })
        assertEquals(4, tries)
    }

    @Test
    fun serverForgetsTheNewKey_asksForAnotherCode() = runBlocking {
        val r = repairer(statusWith = { token ->
            if (token == "new-key-1") throw ApiException(401, "Unknown device") else DeviceStatus(paired = true)
        })
        assertEquals(Repairer.Outcome.NEW_KEY_PAIRED, withTimeout(5_000) { r.run() })
        assertEquals(2, registrations)
        assertEquals("new-key-2", pending)
    }
}
