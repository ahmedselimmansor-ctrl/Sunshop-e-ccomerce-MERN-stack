import { SESClient, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { LOCALE_DIRECTION, type Locale } from '@sunshop/shared';
import nodemailer, { type Transporter } from 'nodemailer';

import { env, isProduction } from '../config/env';
import { moduleLogger } from '../observability/logger';

const log = moduleLogger('mailer');

/**
 * Transactional email.
 *
 * Three drivers: SES for AWS (no SMTP credentials to rotate, the pod's IRSA
 * role is the credential), SMTP for self-hosted or MailHog in dev, and
 * `console` for tests so a unit test never opens a socket.
 *
 * Templates are inlined rather than pulled from a template service: an order
 * confirmation that fails to render because a sidecar is down is worse than one
 * that looks plain. Arabic mails are rendered `dir="rtl"` end to end, which
 * matters because most email clients ignore CSS `direction` on the body.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (env.MAIL_DRIVER === 'ses') {
    const ses = new SESClient({ region: env.AWS_REGION });
    transporter = nodemailer.createTransport({
      SES: { ses, aws: { SendRawEmailCommand } },
    });
  } else if (env.MAIL_DRIVER === 'smtp') {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }

  return transporter;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  locale: Locale;
  /** Deduplication key so an outbox retry cannot double-send. */
  dedupeKey?: string;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  const message = {
    from: env.MAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: {
      'Content-Language': input.locale,
      // Stops autoresponders from bouncing receipts back into support.
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
      ...(input.dedupeKey ? { 'X-Entity-Ref-ID': input.dedupeKey } : {}),
    },
  };

  if (env.MAIL_DRIVER === 'console' || !isProduction) {
    log.info({ to: input.to, subject: input.subject }, 'mail (not delivered in this environment)');
    if (env.MAIL_DRIVER === 'console') return;
  }

  await getTransporter().sendMail(message);
}

// ── Templates ───────────────────────────────────────────────────────────────

interface Copy {
  subject: string;
  heading: string;
  body: string[];
  cta?: { label: string; href: string };
  footer: string;
}

function layout(copy: Copy, locale: Locale): { html: string; text: string } {
  const dir = LOCALE_DIRECTION[locale];
  const align = dir === 'rtl' ? 'right' : 'left';
  const font =
    dir === 'rtl'
      ? "'Segoe UI', Tahoma, 'Noto Naskh Arabic', Arial, sans-serif"
      : "'Segoe UI', Helvetica, Arial, sans-serif";

  const paragraphs = copy.body
    .map((line) => `<p style="margin:0 0 16px;line-height:1.7;color:#334155;">${line}</p>`)
    .join('');

  const button = copy.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
         <tr><td style="border-radius:10px;background:#f59e0b;">
           <a href="${copy.cta.href}" style="display:inline-block;padding:12px 28px;font-weight:600;color:#1c1917;text-decoration:none;border-radius:10px;">${copy.cta.label}</a>
         </td></tr>
       </table>`
    : '';

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.subject}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:${font};direction:${dir};text-align:${align};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e2e8f0;">
        <tr><td>
          <div style="font-size:22px;font-weight:700;color:#f59e0b;margin-bottom:24px;">Sunshop</div>
          <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${copy.heading}</h1>
          ${paragraphs}
          ${button}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">${copy.footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    copy.heading,
    '',
    ...copy.body.map(stripTags),
    copy.cta ? `\n${copy.cta.label}: ${copy.cta.href}` : '',
    '',
    stripTags(copy.footer),
  ]
    .filter(Boolean)
    .join('\n');

  return { html, text };
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

const FOOTER: Record<Locale, string> = {
  en: 'You are receiving this because you have a Sunshop account. This mailbox is not monitored.',
  ar: 'وصلتك هذه الرسالة لأن لديك حسابًا على صن شوب. هذا البريد لا يستقبل الردود.',
};

export async function sendVerificationEmail(input: {
  to: string;
  firstName: string;
  token: string;
  locale: Locale;
}): Promise<void> {
  const href = `${env.PUBLIC_WEB_URL}/verify-email?token=${encodeURIComponent(input.token)}`;
  const copy: Record<Locale, Copy> = {
    en: {
      subject: 'Verify your Sunshop account',
      heading: `Welcome, ${input.firstName}!`,
      body: [
        'Confirm your email address to activate your Sunshop account.',
        'This link expires in 24 hours.',
      ],
      cta: { label: 'Verify email', href },
      footer: FOOTER.en,
    },
    ar: {
      subject: 'فعّل حسابك على صن شوب',
      heading: `أهلًا ${input.firstName}!`,
      body: ['أكّد بريدك الإلكتروني لتفعيل حسابك على صن شوب.', 'الرابط صالح لمدة ٢٤ ساعة.'],
      cta: { label: 'تفعيل البريد', href },
      footer: FOOTER.ar,
    },
  };

  const chosen = copy[input.locale];
  const { html, text } = layout(chosen, input.locale);
  await sendMail({ to: input.to, subject: chosen.subject, html, text, locale: input.locale });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  firstName: string;
  token: string;
  locale: Locale;
}): Promise<void> {
  const href = `${env.PUBLIC_WEB_URL}/reset-password?token=${encodeURIComponent(input.token)}`;
  const copy: Record<Locale, Copy> = {
    en: {
      subject: 'Reset your Sunshop password',
      heading: 'Password reset',
      body: [
        `Hi ${input.firstName}, we received a request to reset your password.`,
        'This link expires in 60 minutes. If you did not request it, you can safely ignore this email: your password has not changed.',
      ],
      cta: { label: 'Choose a new password', href },
      footer: FOOTER.en,
    },
    ar: {
      subject: 'إعادة تعيين كلمة المرور',
      heading: 'إعادة تعيين كلمة المرور',
      body: [
        `مرحبًا ${input.firstName}، وصلنا طلب لإعادة تعيين كلمة المرور.`,
        'الرابط صالح لمدة ٦٠ دقيقة. إذا لم تطلب ذلك، تجاهل الرسالة، لم تتغير كلمة المرور.',
      ],
      cta: { label: 'اختيار كلمة مرور جديدة', href },
      footer: FOOTER.ar,
    },
  };

  const chosen = copy[input.locale];
  const { html, text } = layout(chosen, input.locale);
  await sendMail({ to: input.to, subject: chosen.subject, html, text, locale: input.locale });
}

export async function sendOrderConfirmationEmail(input: {
  to: string;
  firstName: string;
  orderNumber: string;
  total: string;
  locale: Locale;
}): Promise<void> {
  const href = `${env.PUBLIC_WEB_URL}/orders/${input.orderNumber}`;
  const copy: Record<Locale, Copy> = {
    en: {
      subject: `Order ${input.orderNumber} confirmed`,
      heading: 'Thanks for your order!',
      body: [
        `Hi ${input.firstName}, we have received order <strong>${input.orderNumber}</strong>.`,
        `Total: <strong>${input.total}</strong>`,
        'We will email you again as soon as it ships.',
      ],
      cta: { label: 'Track your order', href },
      footer: FOOTER.en,
    },
    ar: {
      subject: `تم تأكيد الطلب ${input.orderNumber}`,
      heading: 'شكرًا لطلبك!',
      body: [
        `مرحبًا ${input.firstName}، استلمنا طلبك رقم <strong>${input.orderNumber}</strong>.`,
        `الإجمالي: <strong>${input.total}</strong>`,
        'سنراسلك فور شحن الطلب.',
      ],
      cta: { label: 'تتبّع الطلب', href },
      footer: FOOTER.ar,
    },
  };

  const chosen = copy[input.locale];
  const { html, text } = layout(chosen, input.locale);
  await sendMail({
    to: input.to,
    subject: chosen.subject,
    html,
    text,
    locale: input.locale,
    dedupeKey: `order-confirmation:${input.orderNumber}`,
  });
}

export async function sendShipmentEmail(input: {
  to: string;
  orderNumber: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string | null;
  locale: Locale;
}): Promise<void> {
  const href = input.trackingUrl ?? `${env.PUBLIC_WEB_URL}/orders/${input.orderNumber}`;
  const copy: Record<Locale, Copy> = {
    en: {
      subject: `Order ${input.orderNumber} has shipped`,
      heading: 'Your order is on its way',
      body: [
        `Carrier: <strong>${input.carrier}</strong>`,
        `Tracking number: <strong>${input.trackingNumber}</strong>`,
      ],
      cta: { label: 'Track shipment', href },
      footer: FOOTER.en,
    },
    ar: {
      subject: `تم شحن الطلب ${input.orderNumber}`,
      heading: 'طلبك في الطريق إليك',
      body: [
        `شركة الشحن: <strong>${input.carrier}</strong>`,
        `رقم التتبّع: <strong>${input.trackingNumber}</strong>`,
      ],
      cta: { label: 'تتبّع الشحنة', href },
      footer: FOOTER.ar,
    },
  };

  const chosen = copy[input.locale];
  const { html, text } = layout(chosen, input.locale);
  await sendMail({
    to: input.to,
    subject: chosen.subject,
    html,
    text,
    locale: input.locale,
    dedupeKey: `shipment:${input.orderNumber}:${input.trackingNumber}`,
  });
}

export async function verifyMailer(): Promise<boolean> {
  if (env.MAIL_DRIVER === 'console') return true;
  try {
    await getTransporter().verify();
    return true;
  } catch (error) {
    log.warn({ err: (error as Error).message }, 'mail transport verification failed');
    return false;
  }
}
