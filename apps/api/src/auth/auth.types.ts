import type { UserRole } from '../generated/prisma/client';

/** Contents of the signed session JWT. Keep it small. */
export interface SessionPayload {
  sub: string; // user id
  role: UserRole;
}

/** Issued after the password step when two-step sign-in is on. Never accepted as a session. */
export interface ChallengePayload {
  sub: string;
  purpose: '2fa';
}

/** The logged-in user attached to each authenticated request. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  regionId: string | null;
  branchId: string | null;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
