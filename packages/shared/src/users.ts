import type { UserRole } from './enums';

/** Shortest password the API accepts. A passphrase of a few words is easier to remember. */
export const MIN_PASSWORD_LENGTH = 12;

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super admin',
  HO_ADMIN: 'Head office admin',
  REGION_MANAGER: 'Region manager',
  BRANCH_VIEWER: 'Branch viewer',
};

/** Head office roles can change content and screens; the others only look, within their area. */
export function canEdit(role: UserRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'HO_ADMIN';
}

export interface UserEntry {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  twoFactor: boolean;
  region: { id: string; name: string } | null;
  branch: { id: string; name: string; code: string | null } | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UsersResponse {
  users: UserEntry[];
  regions: { id: string; name: string }[];
  branches: { id: string; name: string; code: string | null }[];
}

export interface CreateUserRequest {
  email: string;
  name: string;
  role: UserRole;
  regionId?: string | null;
  branchId?: string | null;
  /** First password; the person changes it after signing in. */
  password: string;
}

export interface UpdateUserRequest {
  name?: string;
  role?: UserRole;
  regionId?: string | null;
  branchId?: string | null;
  isActive?: boolean;
}

export interface ResetPasswordRequest {
  password: string;
}

export interface ChangeOwnPasswordRequest {
  currentPassword: string;
  newPassword: string;
}
