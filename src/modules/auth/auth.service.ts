import { nanoid } from 'nanoid';
import { Otp } from '../../models/Otp';
import { User, IUser } from '../../models/User';
import { RefreshToken } from '../../models/RefreshToken';
import { generateOtp, otpExpiry } from '../../utils/otp';
import { smsProvider } from '../../utils/sms';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { AppError } from '../../utils/AppError';
import { durationToMs } from '../../utils/duration';
import { config } from '../../config/env';

const MAX_OTP_ATTEMPTS = 5;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RequestOtpResult {
  phone: string;
  expiresAt: Date;
  /** Echoed back only in development for convenience. */
  devCode?: string;
}

/**
 * Create and store an OTP for a phone number. In development the fixed code is
 * returned to the caller; in production it is only sent via SMS.
 */
export async function requestOtp(phone: string): Promise<RequestOtpResult> {
  const code = generateOtp();
  const expiresAt = otpExpiry();

  // Invalidate any previous unused OTPs for this phone.
  await Otp.updateMany({ phone, used: false }, { used: true });
  await Otp.create({ phone, code, expiresAt, attempts: 0, used: false });

  await smsProvider.send(phone, `Your verification code is ${code}`);

  return {
    phone,
    expiresAt,
    ...(config.isDev ? { devCode: code } : {}),
  };
}

/**
 * Verify an OTP, creating the user if needed, and issue a fresh token pair.
 */
export async function verifyOtp(
  phone: string,
  code: string,
): Promise<{ user: IUser; tokens: TokenPair; isNewUser: boolean }> {
  const otp = await Otp.findOne({ phone, used: false }).sort({ createdAt: -1 });
  if (!otp) throw AppError.badRequest('No active OTP for this phone', 'OTP_NOT_FOUND');

  if (otp.expiresAt.getTime() < Date.now()) {
    otp.used = true;
    await otp.save();
    throw AppError.badRequest('OTP has expired', 'OTP_EXPIRED');
  }

  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    otp.used = true;
    await otp.save();
    throw AppError.badRequest('Too many attempts, request a new code', 'OTP_TOO_MANY_ATTEMPTS');
  }

  if (otp.code !== code) {
    otp.attempts += 1;
    await otp.save();
    throw AppError.badRequest('Incorrect OTP code', 'OTP_INCORRECT');
  }

  otp.used = true;
  await otp.save();

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
    throw AppError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
  }

  const stored = await RefreshToken.findOne({ jti: payload.jti });
  if (!stored || stored.revoked) {
    throw AppError.unauthorized('Refresh token revoked', 'REFRESH_TOKEN_REVOKED');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw AppError.unauthorized('User no longer exists', 'USER_NOT_FOUND');

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
