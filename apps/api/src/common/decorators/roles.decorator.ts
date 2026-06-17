import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';

export const ROLES_KEY = 'roles';

/** Restrict a route to one or more roles (PRD §7 RBAC). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
