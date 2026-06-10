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
    const field = Object.keys(err.keyPattern ?? {}).join(', ');
    sendError(
      res,
      { message: `Duplicate value for: ${field}`, code: 'DUPLICATE_KEY' },
      409,
    );
    return;
  }

  // Mongoose validation / cast errors.
  if (err instanceof MongooseError.ValidationError) {
    sendError(res, { message: err.message, code: 'DB_VALIDATION_ERROR' }, 400);
    return;
  }
  if (err instanceof MongooseError.CastError) {
    sendError(res, { message: `Invalid value for ${err.path}`, code: 'CAST_ERROR' }, 400);
    return;
  }

  // Fallback: unexpected error.
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  const message = config.isDev && err instanceof Error ? err.message : 'Internal server error';
  sendError(res, { message, code: 'INTERNAL_ERROR' }, 500);
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(
    res,
    { message: `Route not found: ${req.method} ${req.originalUrl}`, code: 'ROUTE_NOT_FOUND' },
    404,
  );
}
