export const SESSION_COOKIE = 'darpan_session';

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
