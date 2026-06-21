import { nanoid } from 'nanoid';
import { User, IUser } from '../../models/User';
import { RefreshToken } from '../../models/RefreshToken';
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
 * Ask the SMS gateway to send a verification code. The gateway owns generation +
 * delivery (and later verification) — we don't store or compare codes ourselves.
 */
export async function requestOtp(phone: string): Promise<RequestOtpResult> {
  let result: { devCode?: string };
  try {
    result = await smsProvider.sendOtp(phone);
  } catch (err) {
    // Never crash the request — surface a clear, retryable error to the user, but
    // always log the gateway's REAL reason, and (outside production) echo it back
    // in `details` so it's visible without digging through logs.
    const reason = (err as Error).message;
    // eslint-disable-next-line no-console
    console.error('[otp] send failed:', reason);
    throw AppError.badRequest(
      'ارسال پیامک کد ناموفق بود. لطفاً دوباره تلاش کن.',
      'SMS_SEND_FAILED',
      config.isDev ? { reason } : undefined,
    );
  }
  // Nominal expiry for the client countdown (the gateway enforces real expiry).
  return {
    phone,
    expiresAt: new Date(Date.now() + config.otpTtl * 1000),
    ...(result.devCode ? { devCode: result.devCode } : {}),
  };
}

/**
 * Verify a code via the gateway. On success, create the user if needed and issue
 * a fresh token pair. The gateway enforces expiry / attempts / single-use.
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
  } catch {
    // A malformed/expired token is already effectively logged out.
  }
}
