import { NextFunction, Request, Response } from 'express';
import { MongoServerError } from 'mongodb';
import { Error as MongooseError } from 'mongoose';
import { AppError } from '../utils/AppError';
import { sendError } from '../utils/response';
import { config } from '../config/env';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // next is required for Express to recognize this as an error handler.
  _next: NextFunction,
): void {
  // Known operational errors.
  if (err instanceof AppError) {
    sendError(
      res,
      { message: err.message, code: err.code, details: err.details },
      err.statusCode,
    );
    return;
  }

  // Mongo duplicate key.
  if (err instanceof MongoServerError && err.code === 11000) {
    // Keep the field name only in details (machine-readable); the user-facing
    // message stays Persian.
    const field = Object.keys(err.keyPattern ?? {}).join(', ');
    sendError(
      res,
      { message: 'این مقدار قبلاً ثبت شده است', code: 'DUPLICATE_KEY', details: { field } },
      409,
    );
    return;
  }

  // Mongoose validation / cast errors — never expose the raw English message.
  if (err instanceof MongooseError.ValidationError) {
    sendError(res, { message: 'اطلاعات واردشده معتبر نیست', code: 'DB_VALIDATION_ERROR' }, 400);
    return;
  }
  if (err instanceof MongooseError.CastError) {
    sendError(res, { message: 'شناسه یا مقدار واردشده نامعتبر است', code: 'CAST_ERROR' }, 400);
    return;
  }

  // Fallback: unexpected error. In dev we surface the raw message to aid
  // debugging; in production the user only ever sees a Persian generic.
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  const message = config.isDev && err instanceof Error ? err.message : 'خطای داخلی سرور';
  sendError(res, { message, code: 'INTERNAL_ERROR' }, 500);
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(
    res,
    { message: 'مسیر موردنظر یافت نشد', code: 'ROUTE_NOT_FOUND', details: { path: req.originalUrl } },
    404,
  );
}
