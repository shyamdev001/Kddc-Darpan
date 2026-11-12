import { Prisma } from '../generated/prisma/client';
import type { AuthUser } from './auth.types';

/**
 * What part of the bank a user may see. Head office (SUPER_ADMIN, HO_ADMIN) sees everything;
 * a REGION_MANAGER sees the screens of their region, a BRANCH_VIEWER those of their branch.
 * A scoped user with no region/branch set sees nothing rather than everything.
 */
export function isHeadOffice(user: AuthUser): boolean {
  return user.role === 'SUPER_ADMIN' || user.role === 'HO_ADMIN';
}

const NOTHING = '00000000-0000-0000-0000-000000000000';

export function branchScope(user: AuthUser): Prisma.BranchWhereInput {
  if (isHeadOffice(user)) return {};
  if (user.role === 'REGION_MANAGER') return { taluka: { regionId: user.regionId ?? NOTHING } };
  return { id: user.branchId ?? NOTHING };
}

export function screenScope(user: AuthUser): Prisma.ScreenWhereInput {
  if (isHeadOffice(user)) return {};
  return { branch: branchScope(user) };
}

/** The same rule in raw SQL, for a query with the Screen table joined as `alias`. */
export function screenScopeSql(user: AuthUser, alias = 's'): Prisma.Sql {
  if (isHeadOffice(user)) return Prisma.sql`TRUE`;
  const col = Prisma.raw(`${alias}."branchId"`);
  if (user.role === 'REGION_MANAGER') {
    return Prisma.sql`${col} IN (SELECT b2."id" FROM "Branch" b2 JOIN "Taluka" t2 ON t2."id" = b2."talukaId" WHERE t2."regionId" = ${user.regionId ?? NOTHING}::uuid)`;
  }
  return Prisma.sql`${col} = ${user.branchId ?? NOTHING}::uuid`;
}
