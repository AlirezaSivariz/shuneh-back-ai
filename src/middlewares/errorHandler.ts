import { NextFunction, Request, Response } from 'express';
import { MongoServerError } from 'mongodb';
import { Error as MongooseError } from 'mongoose';
import { AppError } from '../utils/AppError';
import { sendError } from '../utils/response';
import { config } from '../config/env';
import { childLogger } from '../utils/logger';

const log = childLogger({ module: 'errorHandler' });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // next is required for Express to recognize this as an error handler.
  _next: NextFunction,
): void {
  const requestId = (req as any).id as string | undefined;
  const userId = req.user?.id;

  // Known operational errors — log at warn (expected client mistakes).
  if (err instanceof AppError) {
    log.warn(
      { requestId, userId, statusCode: err.statusCode, code: err.code, err },
      `AppError: ${err.message}`,
    );
    sendError(
      res,
      { message: err.message, code: err.code, details: err.details },
      err.statusCode,
    );
    return;
  }

  // Mongo duplicate key.
  if (err instanceof MongoServerError && err.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {}).join(', ');
    log.warn(
      { requestId, userId, field, code: 'DUPLICATE_KEY' },
      'MongoDB duplicate key',
    );
    sendError(
      res,
      { message: 'این مقدار قبلاً ثبت شده است', code: 'DUPLICATE_KEY', details: { field } },
      409,
    );
    return;
  }

  // Mongoose validation / cast errors — never expose the raw English message.
  if (err instanceof MongooseError.ValidationError) {
    log.warn({ requestId, userId, code: 'DB_VALIDATION_ERROR' }, 'Mongoose validation error');
    sendError(res, { message: 'اطلاعات واردشده معتبر نیست', code: 'DB_VALIDATION_ERROR' }, 400);
    return;
  }
  if (err instanceof MongooseError.CastError) {
    log.warn({ requestId, userId, code: 'CAST_ERROR' }, 'Mongoose cast error');
    sendError(res, { message: 'شناسه یا مقدار واردشده نامعتبر است', code: 'CAST_ERROR' }, 400);
    return;
  }

  // Fallback: unexpected error. Log at error level with full stack trace.
  log.error(
    { requestId, userId, err: err instanceof Error ? err : new Error(String(err)) },
    'Unhandled error',
  );
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
