import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config/env';
import { Role } from '../models/User';

export interface AccessTokenPayload {
  sub: string; // user id
  roles: Role[];
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string; // user id
  jti: string; // refresh token id (for revocation)
  type: 'refresh';
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  const options: SignOptions = { expiresIn: config.jwt.accessTtl as SignOptions['expiresIn'] };
  return jwt.sign({ ...payload, type: 'access' }, config.jwt.accessSecret, options);
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'type'>): string {
  const options: SignOptions = { expiresIn: config.jwt.refreshTtl as SignOptions['expiresIn'] };
  return jwt.sign({ ...payload, type: 'refresh' }, config.jwt.refreshSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload;
  if (decoded.type !== 'access') throw new Error('Invalid token type');
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload;
  if (decoded.type !== 'refresh') throw new Error('Invalid token type');
  return decoded;
}
