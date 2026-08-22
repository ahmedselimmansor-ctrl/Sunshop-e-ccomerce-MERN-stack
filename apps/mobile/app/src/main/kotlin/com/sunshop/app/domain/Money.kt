package com.sunshop.app.domain

import com.sunshop.app.data.remote.MoneyDto
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * Money formatting.
 *
 * Amounts cross the wire as integer minor units. The division by the currency's
 * actual fraction digits happens here, once: not with a hardcoded `/ 100`,
 * which would be wrong for the zero-decimal currencies Sunshop may add later.
 */
fun MoneyDto.format(locale: Locale = Locale.getDefault()): String {
    val currencyInstance = runCatching { Currency.getInstance(currency) }.getOrNull()
    val fractionDigits = currencyInstance?.defaultFractionDigits ?: 2
    val divisor = Math.pow(10.0, fractionDigits.toDouble())

    // Latin digits even in Arabic: prices sit next to SKUs and quantities and
    // stay far more scannable this way.
    val formatterLocale = if (locale.language == "ar") Locale.forLanguageTag("ar-EG-u-nu-latn") else locale

    return NumberFormat.getCurrencyInstance(formatterLocale).apply {
        currencyInstance?.let { this.currency = it }
        minimumFractionDigits = fractionDigits
        maximumFractionDigits = fractionDigits
    }.format(amount / divisor)
}

fun MoneyDto.formatRange(max: MoneyDto, locale: Locale = Locale.getDefault()): String =
    if (amount == max.amount) format(locale) else "${format(locale)} - ${max.format(locale)}"
