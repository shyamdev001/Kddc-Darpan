package `in`.kdcc.darpan

/** What the screen-off test found (the test itself: [PowerControl.startTest]). */
data class ScreenOffResult(val wentOff: Boolean, val cameBack: Boolean) {
    /** Safe to switch the panel off at night only when it also comes back by itself. */
    val works: Boolean get() = wentOff && cameBack

    /** For the dashboard's command list; null when it worked. Pure. */
    val problem: String?
        get() = when {
            works -> null
            !wentOff -> "This TV ignores the app's screen-off request. Use the TV's own on/off timer."
            else -> "The screen went off but did not come back by itself. Do not use screen-off on this model; use the TV's own timer."
        }
}
