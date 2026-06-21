/**
 * Operational error carrying an HTTP status code and a stable machine-readable code.
 * Thrown anywhere in the request lifecycle and translated to a uniform response
 * by the central errorHandler middleware.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(statusCode: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown) {
    return new AppError(400, message, code, details);
  }

  static unauthorized(message = 'برای این کار باید وارد شوید', code = 'UNAUTHORIZED') {
    return new AppError(401, message, code);
  }

  static forbidden(message = 'دسترسی غیرمجاز است', code = 'FORBIDDEN') {
    return new AppError(403, message, code);
  }

  static notFound(message = 'موردی یافت نشد', code = 'NOT_FOUND') {
    return new AppError(404, message, code);
  }

  static conflict(message: string, code = 'CONFLICT') {
    return new AppError(409, message, code);
  }
}
