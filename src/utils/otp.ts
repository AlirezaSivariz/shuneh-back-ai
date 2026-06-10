import { config } from '../config/env';

/**
 * OTP generation. In development we use a fixed, predictable code so it can be
 * echoed back in the response and used directly. In production this should be
 * replaced by a cryptographically random code (and never returned to the client).
 */
const DEV_FIXED_CODE = '123456';

export function generateOtp(): string {
  if (config.isDev) return DEV_FIXED_CODE;
  // 6-digit random code for production.
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function otpExpiry(): Date {
  return new Date(Date.now() + config.otpTtl * 1000);
}
