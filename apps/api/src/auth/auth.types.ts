import type { UserRole } from '../generated/prisma/client';

/** Contents of the signed session JWT. Keep it small. */
export interface SessionPayload {
  sub: string; // user id
  role: UserRole;
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
