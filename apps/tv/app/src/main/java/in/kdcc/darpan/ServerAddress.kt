package `in`.kdcc.darpan

/** Checks the server address typed on the setup screen. */
object ServerAddress {
    private val shape = Regex("""^https?://[^\s/:]+(:\d{1,5})?$""")

    /**
     * The cleaned-up address, or null if it is not usable. Without a scheme, https:// is assumed
     * (http:// in the debug build). `allowHttp` is false in release builds: branch TVs talk to the
     * server only over HTTPS, so their key never crosses the network in plain text.
     */
    fun normalize(input: String, allowHttp: Boolean): String? {
        var s = input.trim().trimEnd('/')
        if (s.isEmpty() || s in setOf("http:", "http://", "https:", "https://")) return null
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = (if (allowHttp) "http://" else "https://") + s
        if (!allowHttp && s.startsWith("http://")) return null
        return if (shape.matches(s)) s else null
    }
}
