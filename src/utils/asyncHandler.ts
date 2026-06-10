import { NextFunction, Request, Response, RequestHandler } from 'express';

/**
 * Wrap an async controller so rejected promises are forwarded to the
 * central error handler instead of crashing the process.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
