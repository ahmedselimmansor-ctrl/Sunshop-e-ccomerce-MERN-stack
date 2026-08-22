import { type ZodError, type ZodTypeAny } from 'zod';

import { ApiError, type FieldIssue } from '../utils/ApiError';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Request validation with zod: the same schemas the clients use, so a payload
 * the web app builds is by construction one the API accepts.
 *
 * Parsed output is written to `req.validated`, never back onto `req.body`.
 * That matters for two reasons: Express 5 makes `req.query` a getter that
 * cannot be reassigned, and more importantly, forcing handlers to read
 * `req.validated.body` makes an unvalidated read visible in review.
 */
export interface ValidationTargets {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function toFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

export function validate(targets: ValidationTargets): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: FieldIssue[] = [];

    if (targets.params) {
      const result = targets.params.safeParse(req.params);
      if (result.success) req.validated.params = result.data;
      else issues.push(...prefix(toFieldIssues(result.error), 'params'));
    }

    if (targets.query) {
      const result = targets.query.safeParse(req.query);
      if (result.success) req.validated.query = result.data;
      else issues.push(...prefix(toFieldIssues(result.error), 'query'));
    }

    if (targets.body) {
      const result = targets.body.safeParse(req.body);
      if (result.success) req.validated.body = result.data;
      else issues.push(...prefix(toFieldIssues(result.error), 'body'));
    }

    if (issues.length > 0) return next(ApiError.validation(issues));
    next();
  };
}

function prefix(issues: FieldIssue[], scope: string): FieldIssue[] {
  return issues.map((issue) => ({ ...issue, path: `${scope}.${issue.path}` }));
}

/** Typed accessors so handlers do not litter casts everywhere. */
export function body<T>(req: Request): T {
  return req.validated.body as T;
}

export function query<T>(req: Request): T {
  return req.validated.query as T;
}

export function params<T>(req: Request): T {
  return req.validated.params as T;
}
