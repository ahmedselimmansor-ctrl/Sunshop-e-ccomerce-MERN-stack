import { DEFAULT_LOCALE, type Locale } from '@sunshop/shared';

/**
 * Server-side message catalogue.
 *
 * The API returns localized `message` strings alongside a stable machine
 * `code`. Clients that want their own wording switch on the code; simple
 * clients (and the Kotlin app's error toasts) can render the message directly.
 * Arabic is a first-class locale here, not a fallback.
 */
type Catalogue = Record<string, string>;

const en: Catalogue = {
  'errors.bad_request': 'The request could not be understood.',
  'errors.validation_failed': 'Some fields need your attention.',
  'errors.unauthorized': 'Please sign in to continue.',
  'errors.authentication_required': 'Authentication is required.',
  'errors.invalid_token': 'Your session is invalid. Please sign in again.',
  'errors.token_expired': 'Your session has expired. Please sign in again.',
  'errors.token_stale': 'Your session is no longer valid. Please sign in again.',
  'errors.session_revoked': 'This session was signed out.',
  'errors.token_reuse': 'A security issue was detected. All sessions were signed out.',
  'errors.forbidden': 'You do not have permission to do this.',
  'errors.not_found': 'We could not find what you were looking for.',
  'errors.gone': 'This resource is no longer available.',
  'errors.conflict': 'This conflicts with the current state.',
  'errors.rate_limited': 'Too many requests. Please slow down and try again shortly.',
  'errors.payload_too_large': 'That upload is too large.',
  'errors.unsupported_media_type': 'That file type is not supported.',
  'errors.internal': 'Something went wrong on our side.',
  'errors.service_unavailable': 'The service is temporarily unavailable.',
  'errors.maintenance': 'Sunshop is under maintenance. Please check back soon.',

  'errors.invalid_credentials': 'The email or password is incorrect.',
  'errors.account_locked': 'Too many failed attempts. Try again later.',
  'errors.account_suspended': 'This account has been suspended.',
  'errors.account_not_found': 'Account not found.',
  'errors.email_not_verified': 'Please verify your email address first.',
  'errors.email_taken': 'An account with this email already exists.',
  'errors.password_reused': 'Please choose a password you have not used before.',
  'errors.password_common': 'That password is too common. Please choose another.',
  'errors.password_personal': 'Your password must not contain your name or email.',
  'errors.invalid_reset_token': 'This reset link is invalid or has expired.',
  'errors.invalid_verification_token': 'This verification link is invalid or has expired.',
  'errors.totp_required': 'Enter the code from your authenticator app.',
  'errors.totp_invalid': 'That authentication code is not valid.',
  'errors.cannot_modify_self': 'You cannot perform this action on your own account.',
  'errors.insufficient_rank': 'You cannot manage a user with equal or higher privileges.',

  'errors.out_of_stock': 'Some items are no longer available in the requested quantity.',
  'errors.price_changed': 'Prices in your cart changed. Please review before continuing.',
  'errors.cart_empty': 'Your cart is empty.',
  'errors.invalid_transition': 'That status change is not allowed.',
  'errors.order_not_cancellable': 'This order can no longer be cancelled.',
  'errors.already_refunded': 'This order has already been refunded.',
  'errors.refund_exceeds_total': 'The refund amount exceeds the order total.',
  'errors.total_mismatch': 'The order total changed. Please review your cart.',
  'errors.payment_failed': 'The payment could not be completed.',
  'errors.payments_disabled': 'Card payments are temporarily unavailable.',

  'errors.coupon_invalid': 'This coupon code is not valid.',
  'errors.coupon_expired': 'This coupon has expired.',
  'errors.coupon_not_started': 'This coupon is not active yet.',
  'errors.coupon_usage_limit': 'This coupon has reached its usage limit.',
  'errors.coupon_user_limit': 'You have already used this coupon.',
  'errors.coupon_min_subtotal': 'Your cart does not meet this coupon’s minimum.',
  'errors.coupon_not_applicable': 'This coupon does not apply to the items in your cart.',
  'errors.coupon_first_order_only': 'This coupon is for first orders only.',

  'errors.duplicate_slug': 'That URL slug is already in use.',
  'errors.duplicate_sku': 'That SKU is already in use.',
  'errors.category_has_children': 'Move or delete the subcategories first.',
  'errors.category_cycle': 'A category cannot be its own ancestor.',
  'errors.review_exists': 'You have already reviewed this product.',
  'errors.review_requires_purchase': 'Only verified buyers can review this product.',
  'errors.upload_failed': 'The upload could not be completed.',
  'errors.idempotency_conflict': 'A different request is already in flight with this key.',
  'errors.search_unavailable': 'Search is temporarily degraded. Showing basic results.',

  'success.registered': 'Welcome to Sunshop! Check your email to verify your account.',
  'success.email_verified': 'Your email has been verified.',
  'success.password_reset': 'Your password has been reset.',
  'success.password_changed': 'Your password has been changed.',
  'success.reset_email_sent': 'If that email is registered, a reset link is on its way.',
};

const ar: Catalogue = {
  'errors.bad_request': 'تعذّر فهم الطلب.',
  'errors.validation_failed': 'بعض الحقول تحتاج إلى مراجعة.',
  'errors.unauthorized': 'من فضلك سجّل الدخول للمتابعة.',
  'errors.authentication_required': 'تسجيل الدخول مطلوب.',
  'errors.invalid_token': 'الجلسة غير صالحة. من فضلك سجّل الدخول مرة أخرى.',
  'errors.token_expired': 'انتهت صلاحية الجلسة. من فضلك سجّل الدخول مرة أخرى.',
  'errors.token_stale': 'لم تعد الجلسة صالحة. من فضلك سجّل الدخول مرة أخرى.',
  'errors.session_revoked': 'تم تسجيل الخروج من هذه الجلسة.',
  'errors.token_reuse': 'تم رصد مشكلة أمنية وتسجيل الخروج من كل الجلسات.',
  'errors.forbidden': 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  'errors.not_found': 'لم نتمكن من العثور على ما تبحث عنه.',
  'errors.gone': 'لم يعد هذا العنصر متاحًا.',
  'errors.conflict': 'هناك تعارض مع الحالة الحالية.',
  'errors.rate_limited': 'طلبات كثيرة جدًا. من فضلك حاول بعد قليل.',
  'errors.payload_too_large': 'حجم الملف كبير جدًا.',
  'errors.unsupported_media_type': 'نوع الملف غير مدعوم.',
  'errors.internal': 'حدث خطأ لدينا. نعمل على إصلاحه.',
  'errors.service_unavailable': 'الخدمة غير متاحة مؤقتًا.',
  'errors.maintenance': 'صن شوب في وضع الصيانة. من فضلك عُد بعد قليل.',

  'errors.invalid_credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'errors.account_locked': 'محاولات فاشلة كثيرة. حاول لاحقًا.',
  'errors.account_suspended': 'تم إيقاف هذا الحساب.',
  'errors.account_not_found': 'الحساب غير موجود.',
  'errors.email_not_verified': 'من فضلك فعّل بريدك الإلكتروني أولًا.',
  'errors.email_taken': 'يوجد حساب مسجّل بهذا البريد بالفعل.',
  'errors.password_reused': 'اختر كلمة مرور لم تستخدمها من قبل.',
  'errors.password_common': 'كلمة المرور شائعة جدًا. اختر واحدة أقوى.',
  'errors.password_personal': 'يجب ألا تحتوي كلمة المرور على اسمك أو بريدك.',
  'errors.invalid_reset_token': 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية.',
  'errors.invalid_verification_token': 'رابط التفعيل غير صالح أو منتهي الصلاحية.',
  'errors.totp_required': 'أدخل الرمز من تطبيق المصادقة.',
  'errors.totp_invalid': 'رمز المصادقة غير صحيح.',
  'errors.cannot_modify_self': 'لا يمكنك تنفيذ هذا الإجراء على حسابك.',
  'errors.insufficient_rank': 'لا يمكنك إدارة مستخدم بصلاحيات مساوية أو أعلى.',

  'errors.out_of_stock': 'بعض المنتجات لم تعد متوفرة بالكمية المطلوبة.',
  'errors.price_changed': 'تغيّرت الأسعار في سلتك. راجعها قبل المتابعة.',
  'errors.cart_empty': 'سلة التسوق فارغة.',
  'errors.invalid_transition': 'تغيير الحالة هذا غير مسموح.',
  'errors.order_not_cancellable': 'لم يعد من الممكن إلغاء هذا الطلب.',
  'errors.already_refunded': 'تم استرداد قيمة هذا الطلب بالفعل.',
  'errors.refund_exceeds_total': 'قيمة الاسترداد أكبر من إجمالي الطلب.',
  'errors.total_mismatch': 'تغيّر إجمالي الطلب. من فضلك راجع سلتك.',
  'errors.payment_failed': 'تعذّر إتمام عملية الدفع.',
  'errors.payments_disabled': 'الدفع بالبطاقة غير متاح مؤقتًا.',

  'errors.coupon_invalid': 'كود الخصم غير صالح.',
  'errors.coupon_expired': 'انتهت صلاحية كود الخصم.',
  'errors.coupon_not_started': 'كود الخصم لم يبدأ بعد.',
  'errors.coupon_usage_limit': 'تم استنفاد عدد مرات استخدام هذا الكود.',
  'errors.coupon_user_limit': 'لقد استخدمت هذا الكود من قبل.',
  'errors.coupon_min_subtotal': 'قيمة السلة أقل من الحد الأدنى لهذا الكود.',
  'errors.coupon_not_applicable': 'كود الخصم لا ينطبق على منتجات سلتك.',
  'errors.coupon_first_order_only': 'هذا الكود للطلب الأول فقط.',

  'errors.duplicate_slug': 'هذا الرابط مستخدم بالفعل.',
  'errors.duplicate_sku': 'رمز المنتج (SKU) مستخدم بالفعل.',
  'errors.category_has_children': 'انقل أو احذف التصنيفات الفرعية أولًا.',
  'errors.category_cycle': 'لا يمكن أن يكون التصنيف تابعًا لنفسه.',
  'errors.review_exists': 'لقد قيّمت هذا المنتج من قبل.',
  'errors.review_requires_purchase': 'التقييم متاح للمشترين فقط.',
  'errors.upload_failed': 'تعذّر رفع الملف.',
  'errors.idempotency_conflict': 'هناك طلب آخر قيد التنفيذ بنفس المفتاح.',
  'errors.search_unavailable': 'البحث يعمل بشكل محدود مؤقتًا. تظهر نتائج أساسية.',

  'success.registered': 'أهلًا بك في صن شوب! راجع بريدك لتفعيل الحساب.',
  'success.email_verified': 'تم تفعيل بريدك الإلكتروني.',
  'success.password_reset': 'تم تغيير كلمة المرور.',
  'success.password_changed': 'تم تغيير كلمة المرور.',
  'success.reset_email_sent': 'إذا كان البريد مسجلًا لدينا فسيصلك رابط إعادة التعيين.',
};

const catalogues: Record<Locale, Catalogue> = { en, ar };

/**
 * Resolves a message key. Unknown keys return the key itself rather than
 * throwing: a missing translation must never turn a 409 into a 500.
 */
export function translate(key: string, locale: Locale = DEFAULT_LOCALE): string {
  return catalogues[locale]?.[key] ?? catalogues[DEFAULT_LOCALE][key] ?? key;
}

/** Field-level validation messages emitted by the shared zod schemas. */
const fieldMessages: Record<Locale, Catalogue> = {
  en: {
    invalid_email: 'Enter a valid email address.',
    invalid_phone: 'Enter a valid phone number in international format.',
    invalid_slug: 'Use letters, numbers and dashes only.',
    invalid_sku: 'Use uppercase letters, numbers and dashes only.',
    password_too_short: 'Use at least 10 characters.',
    password_needs_lowercase: 'Include a lowercase letter.',
    password_needs_uppercase: 'Include an uppercase letter.',
    password_needs_digit: 'Include a number.',
    passwords_do_not_match: 'Passwords do not match.',
    terms_must_be_accepted: 'You must accept the terms to continue.',
    at_least_one_locale_required: 'Provide the text in at least one language.',
    duplicate_sku: 'Two variants share the same SKU.',
    mixed_currencies: 'All variants must use the same currency.',
    compare_at_must_exceed_price: 'The compare-at price must be higher than the price.',
    variant_options_mismatch: 'Each variant must set every option exactly once.',
  },
  ar: {
    invalid_email: 'أدخل بريدًا إلكترونيًا صحيحًا.',
    invalid_phone: 'أدخل رقم هاتف صحيحًا بالصيغة الدولية.',
    invalid_slug: 'استخدم حروفًا وأرقامًا وشرطات فقط.',
    invalid_sku: 'استخدم حروفًا إنجليزية كبيرة وأرقامًا وشرطات فقط.',
    password_too_short: 'استخدم ١٠ أحرف على الأقل.',
    password_needs_lowercase: 'أضف حرفًا إنجليزيًا صغيرًا.',
    password_needs_uppercase: 'أضف حرفًا إنجليزيًا كبيرًا.',
    password_needs_digit: 'أضف رقمًا.',
    passwords_do_not_match: 'كلمتا المرور غير متطابقتين.',
    terms_must_be_accepted: 'يجب الموافقة على الشروط للمتابعة.',
    at_least_one_locale_required: 'أدخل النص بلغة واحدة على الأقل.',
    duplicate_sku: 'يوجد تكرار في رمز المنتج بين المتغيرات.',
    mixed_currencies: 'يجب أن تستخدم كل المتغيرات نفس العملة.',
    compare_at_must_exceed_price: 'سعر المقارنة يجب أن يكون أعلى من السعر.',
    variant_options_mismatch: 'كل متغير يجب أن يحدد كل الخيارات مرة واحدة.',
  },
};

export function translateField(key: string, locale: Locale = DEFAULT_LOCALE): string {
  return fieldMessages[locale]?.[key] ?? key;
}
