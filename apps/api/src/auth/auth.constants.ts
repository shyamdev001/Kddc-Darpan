export const SESSION_COOKIE = 'darpan_session';

/** Short-lived proof that the password was right, while the 6-digit code is still to come. */
export const CHALLENGE_COOKIE = 'darpan_2fa';
export const CHALLENGE_TTL_MIN = 5;

export function sessionTtlHours(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return Number.isFinite(hours) && hours > 0 ? hours : 12;
}

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'change-me' || secret.length < 32) {
    throw new Error('JWT_SECRET must be set in .env to a random string of 32+ characters.');
  }
  return secret;
}
