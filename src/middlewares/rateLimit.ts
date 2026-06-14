import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

/**
 * Minimal in-memory fixed-window rate limiter (no extra dependency). Suitable
 * for a single-process deployment; swap for a Redis-backed limiter when scaling
 * horizontally. Keys by authenticated user id when available, else by IP.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(options: { windowMs: number; max: number; key?: string }) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max } = options;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    const id = req.user?.id ?? req.ip ?? 'anon';
    const key = `${options.key ?? 'rl'}:${id}`;

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      throw new AppError(429, 'تعداد درخواست‌ها بیش از حد مجاز است', 'RATE_LIMITED');
    }
    next();
  };
}
