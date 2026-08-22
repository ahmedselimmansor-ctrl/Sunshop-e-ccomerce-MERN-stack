package com.sunshop.app.data.remote

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Every product name, description and option label goes through `resolve`. The
 * fallback matters: a catalogue entry translated on only one side must still
 * render something rather than an empty string.
 */
class LocalizedTextTest {

    private val both = LocalizedText(en = "Cotton Tee", ar = "تي شيرت قطني")

    @Test
    fun `picks english for an english locale`() {
        assertEquals("Cotton Tee", both.resolve("en"))
    }

    @Test
    fun `picks arabic for an arabic locale`() {
        assertEquals("تي شيرت قطني", both.resolve("ar"))
    }

    @Test
    fun `matches arabic regional tags, not just the bare language`() {
        assertEquals("تي شيرت قطني", both.resolve("ar-EG"))
    }

    @Test
    fun `treats any non-arabic language as english`() {
        assertEquals("Cotton Tee", both.resolve("fr"))
    }

    @Test
    fun `falls back to english when arabic is missing`() {
        val enOnly = LocalizedText(en = "Cotton Tee", ar = "")

        assertEquals("Cotton Tee", enOnly.resolve("ar"))
    }

    @Test
    fun `falls back to arabic when english is missing`() {
        val arOnly = LocalizedText(en = "", ar = "تي شيرت قطني")

        assertEquals("تي شيرت قطني", arOnly.resolve("en"))
    }

    @Test
    fun `treats whitespace as missing rather than as content`() {
        val blank = LocalizedText(en = "   ", ar = "تي شيرت قطني")

        assertEquals("تي شيرت قطني", blank.resolve("en"))
    }

    @Test
    fun `returns empty when neither side has content`() {
        assertEquals("", LocalizedText().resolve("en"))
        assertEquals("", LocalizedText().resolve("ar"))
    }
}
