import pino from 'pino';
import { config } from '../config/env';

/**
 * Structured logger built on pino. In development, logs are pretty-printed
 * for readability. In production, they are emitted as newline-delimited JSON
 * for easy ingestion by log aggregators (Datadog, CloudWatch, ELK, etc.).
 *
 * Every log line includes: timestamp, level, message, and any structured
 * fields the caller attaches (e.g. { orderId, trackId }).
 */
const logger = pino({
  level: config.isDev ? 'debug' : 'info',
  ...(config.isDev
    ? {
        transport: {
          target: 'pino/file',
          options: { destination: 1 }, // stdout
        },
      }
    : {}),
  base: { pid: process.pid, env: config.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

/**
 * Create a child logger bound to a module/context name.
 * Usage: `const log = logger.child({ module: 'payment' });`
 */
export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}

/**
 * Mask a phone number for logs: 0912***6789
 * Never log full subscriber numbers.
 */
export function maskMobile(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length < 8 ? '***' : `${d.slice(0, 4)}***${d.slice(-4)}`;
}

/**
 * Mask a Zibal trackId for logs: first 6 chars + ellipsis.
 */
export function maskTrack(t?: string | null): string {
  return t ? `${String(t).slice(0, 6)}…` : '∅';
}

export default logger;
