import { nanoid } from 'nanoid';
import bcryptjs from 'bcryptjs';
import { Types } from 'mongoose';
import { User, IUser } from '../../models/User';
import { RefreshToken } from '../../models/RefreshToken';
import { AuditLog } from '../../models/AuditLog';
import { smsProvider } from '../../utils/sms';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { AppError } from '../../utils/AppError';
import { durationToMs } from '../../utils/duration';
import { config } from '../../config/env';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RequestOtpResult {
  phone: string;
  expiresAt: Date;
  /** Echoed back only by the dev stub for convenience. */
  devCode?: string;
}

/**
 * Append an immutable audit record for a login/logout. Mirrors the admin audit
 * pattern — the actor is stored in `adminId` (a ref to User) so the admin logs
 * page resolves the phone automatically. Never throws into the auth flow.
 */
async function audit(
  userId: string | Types.ObjectId,
  action: string,
  targetType: string,
  targetId: string,
  summary?: Record<string, unknown>,
) {
  try {
    await AuditLog.create({
      adminId: new Types.ObjectId(userId),
      action,
      targetType,
      targetId,
      summary: summary ?? null,
    });
  } catch {
    /* auditing must never break login/logout */
  }
}

/**
 * Ask the SMS gateway to send a verification code. The gateway owns generation +
 * delivery (and later verification) — we don't store or compare codes ourselves.
 */
export async function requestOtp(phone: string): Promise<RequestOtpResult> {
  let result: { devCode?: string };
  try {
    result = await smsProvider.sendOtp(phone);
  } catch (err) {
    const reason = (err as Error).message;
    // eslint-disable-next-line no-console
    console.error('[otp] send failed:', reason);
    throw AppError.badRequest(
      'ارسال پیامک کد ناموفق بود. لطفاً دوباره تلاش کن.',
      'SMS_SEND_FAILED',
      config.isDev ? { reason } : undefined,
    );
  }
  return {
    phone,
    expiresAt: new Date(Date.now() + config.otpTtl * 1000),
    ...(result.devCode ? { devCode: result.devCode } : {}),
  };
}

/**
 * Verify a code via the gateway. On success, create the user if needed and issue
 * a fresh token pair.
 */
export async function verifyOtp(
  phone: string,
  code: string,
): Promise<{ user: IUser; tokens: TokenPair; isNewUser: boolean }> {
  let valid: boolean;
  try {
    valid = await smsProvider.verifyOtp(phone, code);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[otp] verify failed:', (err as Error).message);
    throw AppError.badRequest('بررسی کد ناموفق بود. لطفاً دوباره تلاش کن.', 'OTP_VERIFY_FAILED');
  }
  if (!valid) {
    throw AppError.badRequest('کد واردشده نادرست یا منقضی شده است.', 'OTP_INCORRECT');
  }

  let user = await User.findOne({ phone });
  let isNewUser = false;
  if (!user) {
    user = await User.create({ phone, roles: [] });
    isNewUser = true;
  }

  const tokens = await issueTokens(user);
  await audit(user._id, 'auth.login', 'user', user._id.toString(), {
    method: 'otp',
    isNewUser,
  });
  return { user, tokens, isNewUser };
}

/**
 * Sign an access + refresh token pair and persist the refresh token's id
 * so it can be revoked later.
 */
export async function issueTokens(user: IUser): Promise<TokenPair> {
  const jti = nanoid();
  const refreshTtlMs = durationToMs(config.jwt.refreshTtl);
  await RefreshToken.create({
    jti,
    userId: user._id,
    expiresAt: new Date(Date.now() + refreshTtlMs),
    revoked: false,
  });

  const accessToken = signAccessToken({ sub: user._id.toString(), roles: user.roles });
  const refreshToken = signRefreshToken({ sub: user._id.toString(), jti });
  return { accessToken, refreshToken };
}

/**
 * Exchange a valid, non-revoked refresh token for a new access token (rotating
 * the refresh token for safety).
 */
export async function refresh(refreshToken: string): Promise<TokenPair> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized('نشست شما منقضی شده است؛ دوباره وارد شوید', 'INVALID_REFRESH_TOKEN');
  }

  const stored = await RefreshToken.findOne({ jti: payload.jti });
  if (!stored || stored.revoked) {
    throw AppError.unauthorized('نشست شما منقضی شده است؛ دوباره وارد شوید', 'REFRESH_TOKEN_REVOKED');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw AppError.unauthorized('حساب کاربری شما یافت نشد', 'USER_NOT_FOUND');

  // Rotate: revoke the old token, issue a brand new pair.
  stored.revoked = true;
  await stored.save();

  return issueTokens(user);
}

/** Revoke a refresh token (logout). Idempotent. */
export async function logout(refreshToken: string): Promise<void> {
  try {
    const payload = verifyRefreshToken(refreshToken);
    await RefreshToken.updateOne({ jti: payload.jti }, { revoked: true });
    await audit(payload.sub, 'auth.logout', 'user', payload.sub, {
      sessionId: payload.jti,
    });
  } catch {
    // A malformed/expired token is already effectively logged out.
  }
}

// ──────────────── Password-based auth ────────────────

/**
 * Login with phone + password. Issues a token pair on success.
 */
export async function loginWithPassword(
  phone: string,
  password: string,
): Promise<{ user: IUser; tokens: TokenPair }> {
  const user = await User.findOne({ phone });
  if (!user) {
    throw AppError.badRequest('کاربری با این شماره یافت نشد', 'USER_NOT_FOUND');
  }
  if (!user.password) {
    throw AppError.badRequest(
      'این کاربر هنوز رمز عبور تنظیم نکرده است. لطفاً با کد تأیید وارد شوید.',
      'NO_PASSWORD',
    );
  }

  const valid = await bcryptjs.compare(password, user.password);
  if (!valid) {
    throw AppError.badRequest('رمز عبور واردشده نادرست است', 'INVALID_PASSWORD');
  }

  const tokens = await issueTokens(user);
  await audit(user._id, 'auth.login', 'user', user._id.toString(), {
    method: 'password',
  });
  return { user, tokens };
}

/**
 * Set initial password for a user who has none yet (first-time setup).
 * Requires authentication (the access token from OTP verify).
 */
export async function setPassword(userId: string, password: string): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
  if (user.password) {
    throw AppError.badRequest('شما قبلاً رمز عبور تنظیم کرده‌اید', 'PASSWORD_ALREADY_SET');
  }

  user.password = await bcryptjs.hash(password, 12);
  await user.save();
}

/**
 * Reset password via OTP verification (forgot-password flow).
 * Verifies the OTP, then sets the new password hash.
 */
export async function resetPassword(
  phone: string,
  code: string,
  password: string,
): Promise<void> {
  let valid: boolean;
  try {
    valid = await smsProvider.verifyOtp(phone, code);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[otp] verify failed:', (err as Error).message);
    throw AppError.badRequest('بررسی کد ناموفق بود. لطفاً دوباره تلاش کن.', 'OTP_VERIFY_FAILED');
  }
  if (!valid) {
    throw AppError.badRequest('کد واردشده نادرست یا منقضی شده است.', 'OTP_INCORRECT');
  }

  const user = await User.findOne({ phone });
  if (!user) throw AppError.notFound('کاربری با این شماره یافت نشد', 'USER_NOT_FOUND');

  user.password = await bcryptjs.hash(password, 12);
  await user.save();
}
