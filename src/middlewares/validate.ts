import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny, ZodError } from 'zod';
import { AppError } from '../utils/AppError';

interface ValidationSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Generic validation middleware. Validates and replaces req.body/query/params
 * with the parsed (and coerced) result so controllers receive clean data.
 */
export function validate(schema: ValidationSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) {
        const parsed = schema.query.parse(req.query);
        // req.query is read-only on newer Express typings; mutate in place.
        Object.assign(req.query, parsed);
      }
      if (schema.params) req.params = schema.params.parse(req.params) as typeof req.params;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        // Surface a Persian top-level message (the client shows `message`
        // verbatim). Prefer the first field message when it is already Persian,
        // otherwise fall back to a clear Persian generic so no raw English
        // (zod's built-in defaults) ever reaches the user. Per-field details are
        // still attached for clients that want them.
        const firstPersian = details.find((d) => /[؀-ۿ]/.test(d.message))?.message;
        next(
          AppError.badRequest(
            firstPersian || 'اطلاعات واردشده معتبر نیست',
            'VALIDATION_ERROR',
            details,
          ),
        );
        return;
      }
      next(err);
    }
  };
}
