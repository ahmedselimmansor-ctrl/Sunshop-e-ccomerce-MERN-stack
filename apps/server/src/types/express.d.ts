import type { Currency, Locale } from '@sunshop/shared';

import type { Principal } from '../security/principal';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id: echoed in the response and in every log line. */
      id: string;
      /** Always present; anonymous callers get `Principal.anonymous()`. */
      principal: Principal;
      locale: Locale;
      currency: Currency;
      /**
       * Output of the zod validation middleware. Handlers read from here, never
       * from `req.body` directly, so an unvalidated field cannot slip through.
       */
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
      /** Anonymous cart identifier, from cookie or header. */
      cartToken?: string;
      /** Raw request body: only captured for the Stripe webhook route. */
      rawBody?: Buffer;
    }
  }
}

export {};
