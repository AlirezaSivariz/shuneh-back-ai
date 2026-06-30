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
  /** Where uploaded images live: 'local' (disk) | 'mongo' (BinData) | 's3'. */
  storageDriver: 'local' | 'mongo' | 's3';
  uploadDir: string;
  /**
   * Storage root for PRIVATE files (ID documents). MUST be outside `uploadDir`
   * so it is never served by the public /uploads static mount.
   */
  privateUploadDir: string;
  s3: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBucket: string;
    privateBucket: string;
    forcePathStyle: boolean;
  };
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
  /** SMS gateway: 'stub' (console log) | 'limosms' (real). */
  smsDriver: 'stub' | 'limosms';
  /** LimoSMS API key (only read from env; never hardcoded). */
  limoSmsApiKey?: string;
  /** Footer/brand suffix sent with LimoSMS OTP messages. */
  limoSmsFooter: string;
  /** LimoSMS sender line number for notification SMS (sendsms). From env only. */
  limoSmsSenderNumber?: string;
  /** Max recipients a stylist may target in ONE discount-SMS campaign send. */
  smsCampaignPerSendMax: number;
  /** Max discount-campaign SMS a stylist may send PER DAY (anti-spam/cost). */
  smsCampaignDailyMax: number;
  /** Payment gateway driver: 'stub' (no real money) | 'zibal'. */
  paymentDriver: 'stub' | 'zibal';
  /** Zibal IPG config. `merchant` = "zibal" for the sandbox. Server-only. */
  zibal: {
    merchant: string;
    baseUrl: string; // https://gateway.zibal.ir
  };
}

const nodeEnv = (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development';

export const config: AppConfig = {
  nodeEnv,
  isDev: nodeEnv !== 'production',
  port: asNumber('PORT', 4000),
  baseUrl: required('BASE_URL', 'http://localhost:4000'),
  webBaseUrl: required('WEB_BASE_URL', 'http://localhost:3000'),
  // Prefer MONGODB_URI (the Atlas-standard name); fall back to legacy MONGO_URI.
  mongoUri:
    process.env.MONGODB_URI ||
    required('MONGO_URI', 'mongodb://127.0.0.1:27017/salon_reservation'),
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev_access_secret'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
    accessTtl: required('ACCESS_TTL', '15m'),
    refreshTtl: required('REFRESH_TTL', '7d'),
  },
  otpTtl: asNumber('OTP_TTL', 300),
  storageDriver: ((process.env.STORAGE_DRIVER || 'local').toLowerCase() as AppConfig['storageDriver']),
  uploadDir: required('UPLOAD_DIR', 'uploads'),
  privateUploadDir: required('PRIVATE_UPLOAD_DIR', 'uploads-private'),
  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    publicBucket: process.env.S3_PUBLIC_BUCKET || '',
    privateBucket: process.env.S3_PRIVATE_BUCKET || process.env.S3_PUBLIC_BUCKET || '',
    forcePathStyle: asBool('S3_FORCE_PATH_STYLE', true),
  },
  disableCron: asBool('DISABLE_CRON', false),
  autoCompleteIntervalMinutes: asNumber('AUTOCOMPLETE_INTERVAL_MINUTES', 5),
  quickRebookThreshold: asNumber('QUICK_REBOOK_THRESHOLD', 2),
  internalApiKey: process.env.INTERNAL_API_KEY || undefined,
  adminPhone: process.env.ADMIN_PHONE || undefined,
  smsDriver: (process.env.SMS_DRIVER || 'stub').toLowerCase() as AppConfig['smsDriver'],
  limoSmsApiKey: process.env.LIMOSMS_API_KEY || undefined,
  limoSmsFooter: process.env.LIMOSMS_FOOTER || 'شونه',
  // LimoSMS expects the literal string "vip" as the sender (per their support),
  // not a line number. Overridable via env if that ever changes.
  limoSmsSenderNumber: process.env.LIMOSMS_SENDER_NUMBER || 'vip',
  smsCampaignPerSendMax: asNumber('SMS_CAMPAIGN_PER_SEND_MAX', 50),
  smsCampaignDailyMax: asNumber('SMS_CAMPAIGN_DAILY_MAX', 100),
  paymentDriver: (process.env.PAYMENT_DRIVER || 'stub').toLowerCase() as AppConfig['paymentDriver'],
  zibal: {
    // "zibal" is Zibal's documented sandbox merchant; use the real merchant in prod.
    merchant: process.env.ZIBAL_MERCHANT || 'zibal',
    baseUrl: (process.env.ZIBAL_BASE_URL || 'https://gateway.zibal.ir').replace(/\/$/, ''),
  },
};
