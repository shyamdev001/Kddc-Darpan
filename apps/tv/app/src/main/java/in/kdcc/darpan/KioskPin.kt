package `in`.kdcc.darpan

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * The kiosk PIN as head office set it: never the PIN itself, only a salted PBKDF2-HMAC-SHA1 hash
 * (SHA1 because PBKDF2 with SHA-256 needs Android 8; the iterations carry the cost). Sent in the
 * manifest settings and kept on the TV, so the local unlock works with no server at all (K1).
 */
@Serializable
data class KioskPinHash(val salt: String, val hash: String, val iterations: Int)

/** Local unlock: Menu five times, then the PIN; five wrong PINs block it for 15 minutes. */
object KioskPin {
    const val PRESSES = 5
    const val PRESS_WINDOW_MS = 3_000L
    const val MAX_FAILURES = 5
    const val BLOCK_MS = 15 * 60_000L
    private const val MAX_ITERATIONS = 200_000

    /** True when [pin] is the one head office set. Slow on purpose: call off the main thread. */
    fun matches(pin: String, h: KioskPinHash): Boolean {
        if (!pin.matches(Regex("\\d{4,12}")) || h.iterations !in 1..MAX_ITERATIONS) return false
        val salt = hex(h.salt) ?: return false
        val want = hex(h.hash) ?: return false
        val spec = PBEKeySpec(pin.toCharArray(), salt, h.iterations, want.size * 8)
        val got = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(spec).encoded
        return MessageDigest.isEqual(got, want)
    }

    private fun hex(s: String): ByteArray? {
        if (s.length % 2 != 0 || s.isEmpty() || !s.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
        return ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    /** Wrong PINs in a row and when the block ends (wall clock). */
    data class Gate(val failures: Int = 0, val blockedUntil: Long = 0)

    /**
     * How long the PIN box stays blocked. A clock set back cannot stretch the block beyond 15 minutes,
     * and a clock set forward ends it early (a TV clock after a power cut is often wrong; either way
     * the next five tries cost another 15 minutes).
     */
    fun blockedFor(g: Gate, now: Long): Long = (g.blockedUntil - now).coerceIn(0, BLOCK_MS)

    /** After a wrong PIN: the new gate, and whether this try started a block. */
    fun wrong(g: Gate, now: Long): Pair<Gate, Boolean> {
        val failures = g.failures + 1
        return if (failures >= MAX_FAILURES) Gate(0, now + BLOCK_MS) to true else Gate(failures, 0) to false
    }

    /** Counts Menu presses: true on the fifth within three seconds. */
    class Presses(private val needed: Int = PRESSES, private val windowMs: Long = PRESS_WINDOW_MS) {
        private val times = ArrayDeque<Long>()

        /** How many presses are in the current run, after [press]. */
        val count: Int get() = times.size

        fun press(elapsedNow: Long): Boolean {
            while (times.isNotEmpty() && elapsedNow - times.first() > windowMs) times.removeFirst()
            times.addLast(elapsedNow)
            if (times.size >= needed) {
                times.clear()
                return true
            }
            return false
        }
    }

    // ---------- Stored on the TV ----------

    private const val PREFS = "darpan-kiosk"
    private const val KEY_FAILURES = "pinFailures"
    private const val KEY_BLOCKED = "pinLockedUntil"
    private const val KEY_EVENTS = "events"
    private const val MAX_EVENTS = 20
    private const val EVENT_KEEP_MS = 24 * 3_600_000L
    private val json = Json { ignoreUnknownKeys = true }

    fun gate(context: Context): Gate {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Gate(p.getInt(KEY_FAILURES, 0), p.getLong(KEY_BLOCKED, 0))
    }

    fun saveGate(context: Context, g: Gate) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(KEY_FAILURES, g.failures).putLong(KEY_BLOCKED, g.blockedUntil).commit()
    }

    /** A local unlock or a wrong PIN, kept a day and sent in every heartbeat for the activity log. */
    @Serializable
    data class Event(val id: String, val kind: String, val at: Long)

    /** Kinds: pinUnlock, pinFailed, pinBlocked, offlineUnlock. */
    fun record(context: Context, kind: String, now: Long = System.currentTimeMillis()) {
        val events = (events(context, now) + Event(UUID.randomUUID().toString(), kind, now)).takeLast(MAX_EVENTS)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_EVENTS, json.encodeToString(events)).commit()
    }

    /** The last day's events, newest last. The server records each id once. */
    fun events(context: Context, now: Long = System.currentTimeMillis()): List<Event> = try {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_EVENTS, null)
        if (raw == null) emptyList() else keep(json.decodeFromString<List<Event>>(raw), now)
    } catch (e: Exception) {
        emptyList()
    }

    /** Pure: drops events older than a day (or from a clock far ahead). */
    fun keep(events: List<Event>, now: Long): List<Event> = events.filter { now - it.at in 0..EVENT_KEEP_MS }.takeLast(MAX_EVENTS)
}
