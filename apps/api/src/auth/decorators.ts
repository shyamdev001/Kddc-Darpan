import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/client';

/** Routes are private by default. Mark a route or controller @Public() to skip login. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Reachable while the bank's policy still requires this person to set up two-step sign-in
 * (sign out, see who you are, set it up).
 */
export const ALLOW_WITHOUT_2FA_KEY = 'allowWithout2fa';
export const AllowWithout2fa = () => SetMetadata(ALLOW_WITHOUT_2FA_KEY, true);

/** Restrict a route to these roles. SUPER_ADMIN always passes. */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Inject the logged-in user: `me(@CurrentUser() user: AuthUser)`. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().user;
});
