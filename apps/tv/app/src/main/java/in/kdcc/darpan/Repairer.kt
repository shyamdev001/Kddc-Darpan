package `in`.kdcc.darpan

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Runs when the server refuses a paired TV's key (401/403) while the TV keeps playing its saved ads.
 *
 * A refused key is not proof the screen was removed: the server may have been restored from a backup,
 * or answered wrongly for a moment. So the screen never goes blank. In the background this:
 * 1. checks whether the old key works again (then nothing else is needed);
 * 2. otherwise asks for a new key and shows its pairing code in a corner, until head office enters it.
 * Only an explicit "removed" message from the server stops the ads (see MainActivity.onRemoved).
 */
class Repairer(
    /** True when the old key is accepted again and the screen is paired. Throws on network errors. */
    private val oldKeyWorks: suspend () -> Boolean,
    private val register: suspend () -> RegisterResponse,
    /** The pairing state as seen with the new key. Throws ApiException(401) if the server forgot that key. */
    private val statusWith: suspend (token: String) -> DeviceStatus,
    private val pendingToken: () -> String?,
    private val savePending: (RegisterResponse) -> Unit,
    private val dropPending: () -> Unit,
    /** The code to show in the corner; null hides it. */
    private val showCode: (String?) -> Unit,
    private val pollMs: Long = 10_000L,
    private val maxBackoffMs: Long = 60_000L,
) {
    enum class Outcome { OLD_KEY_WORKS, NEW_KEY_PAIRED }

    /** Returns once the TV can talk to the server again, one way or the other. */
    suspend fun run(): Outcome {
        var backoff = pollMs
        while (true) {
            try {
                if (oldKeyWorks()) {
                    dropPending()
                    showCode(null)
                    return Outcome.OLD_KEY_WORKS
                }
                var token = pendingToken()
                if (token == null) {
                    val r = register()
                    savePending(r)
                    showCode(r.pairingCode)
                    token = r.deviceToken
                }
                val s = statusWith(token)
                if (s.paired) {
                    showCode(null)
                    return Outcome.NEW_KEY_PAIRED
                }
                showCode(s.pairingCode)
                backoff = pollMs
                delay(pollMs)
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                if (e.code == 401) dropPending() // the server forgot the new key too: ask again
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(maxBackoffMs)
            } catch (e: Exception) {
                delay(backoff) // no network: keep playing, try again later
                backoff = (backoff * 2).coerceAtMost(maxBackoffMs)
            }
        }
    }
}
