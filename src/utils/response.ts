import { Response } from 'express';

/**
 * Uniform success/error envelope used across every endpoint:
 *   { success, data? }  or  { success, error? }
 */
export interface ApiError {
  message: string;
  code: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  const body: ApiResponse<T> = { success: true, data };
  return res.status(statusCode).json(body);
}

export function sendError(res: Response, error: ApiError, statusCode = 400): Response {
  const body: ApiResponse = { success: false, error };
  return res.status(statusCode).json(body);
}
