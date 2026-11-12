import type { UserRole } from './enums';

/** Who must set up two-step sign-in before using the dashboard (env REQUIRE_2FA). */
export const TWO_FACTOR_POLICIES = ['off', 'admins', 'all'] as const;
export type TwoFactorPolicy = (typeof TWO_FACTOR_POLICIES)[number];

export function twoFactorRequired(policy: TwoFactorPolicy, role: UserRole): boolean {
  if (policy === 'all') return true;
  if (policy === 'admins') return role === 'SUPER_ADMIN' || role === 'HO_ADMIN';
  return false;
}

export const RECOVERY_CODE_COUNT = 8;

export interface TwoFactorStatus {
  enabled: boolean;
  /** The bank's policy says this person must have it on. */
  required: boolean;
  recoveryCodesLeft: number;
}

/** Shown once while setting up: scan the QR code, or type the key by hand. */
export interface TwoFactorSetupResponse {
  qrSvg: string;
  secret: string;
  otpauthUrl: string;
}

export interface TwoFactorEnableResponse {
  status: TwoFactorStatus;
  /** Shown once. Each works one time instead of a code from the phone. */
  recoveryCodes: string[];
}

/** POST /auth/login answers with the user, or asks for the 6-digit code first. */
export type LoginResponse = { user: unknown; needsCode?: false } | { needsCode: true };
