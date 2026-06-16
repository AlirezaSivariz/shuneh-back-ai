import dotenv from 'dotenv';

dotenv.config();

/**
 * Typed, validated access to environment variables.
 * Throws early on startup if a required variable is missing.
 */
function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function asNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
}

function asBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  isDev: boolean;
  port: number;
  baseUrl: string;
  /** Public base URL of the frontend (used to build invite links). */
  webBaseUrl: string;
  mongoUri: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  otpTtl: number; // seconds
  uploadDir: string;
  /**
   * Storage root for PRIVATE files (ID documents). MUST be outside `uploadDir`
   * so it is never served by the public /uploads static mount.
   */
  privateUploadDir: string;
  /** When true, no scheduled jobs are registered (tests / one-off scripts). */
  disableCron: boolean;
  /** How often the reservation auto-complete job runs, in minutes. */
  autoCompleteIntervalMinutes: number;
  /** Min times a (stylist, service) must have been completed to be suggested. */
  quickRebookThreshold: number;
  /** Optional shared secret guarding the /internal endpoints. */
  internalApiKey?: string;
  /** Phone of the bootstrap admin (used by the admin seed script only). */
  adminPhone?: string;
}

const nodeEnv = (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development';

export const config: AppConfig = {
  nodeEnv,
  isDev: nodeEnv !== 'production',
  port: asNumber('PORT', 4000),
  baseUrl: required('BASE_URL', 'http://localhost:4000'),
  webBaseUrl: required('WEB_BASE_URL', 'http://localhost:3000'),
  mongoUri: required('MONGO_URI', 'mongodb://127.0.0.1:27017/salon_reservation'),
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev_access_secret'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
    accessTtl: required('ACCESS_TTL', '15m'),
    refreshTtl: required('REFRESH_TTL', '7d'),
  },
  otpTtl: asNumber('OTP_TTL', 300),
  uploadDir: required('UPLOAD_DIR', 'uploads'),
  privateUploadDir: required('PRIVATE_UPLOAD_DIR', 'uploads-private'),
  disableCron: asBool('DISABLE_CRON', false),
  autoCompleteIntervalMinutes: asNumber('AUTOCOMPLETE_INTERVAL_MINUTES', 5),
  quickRebookThreshold: asNumber('QUICK_REBOOK_THRESHOLD', 2),
  internalApiKey: process.env.INTERNAL_API_KEY || undefined,
  adminPhone: process.env.ADMIN_PHONE || undefined,
};
