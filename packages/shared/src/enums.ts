// Keep these in sync with the enums in apps/api/prisma/schema.prisma.

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HO_ADMIN: 'HO_ADMIN',
  REGION_MANAGER: 'REGION_MANAGER',
  BRANCH_VIEWER: 'BRANCH_VIEWER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const MediaType = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export const Orientation = {
  LANDSCAPE: 'LANDSCAPE',
  PORTRAIT: 'PORTRAIT',
} as const;
export type Orientation = (typeof Orientation)[keyof typeof Orientation];

export const ScreenStatus = {
  PENDING: 'PENDING', // registered, waiting to be paired
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
} as const;
export type ScreenStatus = (typeof ScreenStatus)[keyof typeof ScreenStatus];
