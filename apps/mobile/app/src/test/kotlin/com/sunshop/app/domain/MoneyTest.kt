package com.sunshop.app.domain

import com.sunshop.app.data.remote.MoneyDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Money crosses the wire as integer minor units, so every display path runs
 * through `format`. The zero-decimal and three-decimal cases are the ones a
 * hardcoded `/ 100` would silently get wrong.
 */
class MoneyTest {

    /** Non-breaking and narrow-no-break spaces vary by JDK; compare on digits. */
    private fun String.normalized(): String = replace(' ', ' ').replace(' ', ' ')

    @Test
    fun `formats a two-decimal currency from minor units`() {
        val formatted = MoneyDto(amount = 3499, currency = "USD").format(Locale.US)

        assertEquals("$34.99", formatted.normalized())
    }

    @Test
    fun `does not divide zero-decimal currencies`() {
        // JPY has no minor unit: 4299 yen is 4299 yen, not 42.99.
        val formatted = MoneyDto(amount = 4299, currency = "JPY").format(Locale.US)

        assertTrue("expected 4,299 in $formatted", formatted.contains("4,299"))
        assertTrue("must not have decimals: $formatted", !formatted.contains("42.99"))
    }

    @Test
    fun `divides three-decimal currencies by a thousand`() {
        // KWD has 3 fraction digits.
        val formatted = MoneyDto(amount = 1234567, currency = "KWD").format(Locale.US)

        assertTrue("expected 1,234.567 in $formatted", formatted.contains("1,234.567"))
    }

    @Test
    fun `falls back to two decimals for an unknown currency code`() {
        val formatted = MoneyDto(amount = 1999, currency = "XYZ").format(Locale.US)

        assertTrue("expected 19.99 in $formatted", formatted.contains("19.99"))
    }

    @Test
    fun `renders latin digits under an arabic locale`() {
        val formatted = MoneyDto(amount = 24900, currency = "USD").format(Locale.forLanguageTag("ar"))

        // Arabic-Indic digits (٠-٩) would make prices unscannable next to SKUs.
        assertTrue("expected latin digits, got $formatted", formatted.any { it in '0'..'9' })
        assertTrue("found arabic-indic digits in $formatted", formatted.none { it in '٠'..'٩' })
    }

    @Test
    fun `zero formats as zero rather than blank`() {
        assertEquals("$0.00", MoneyDto(amount = 0, currency = "USD").format(Locale.US).normalized())
    }

    @Test
    fun `collapses a range whose ends are equal`() {
        val price = MoneyDto(amount = 2500, currency = "USD")

        assertEquals("$25.00", price.formatRange(price, Locale.US).normalized())
    }

    @Test
    fun `renders both ends of a real range`() {
        val min = MoneyDto(amount = 2500, currency = "USD")
        val max = MoneyDto(amount = 4500, currency = "USD")

        assertEquals("$25.00 - $45.00", min.formatRange(max, Locale.US).normalized())
    }
}
