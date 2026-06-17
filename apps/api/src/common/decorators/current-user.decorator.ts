import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';

export interface RequestUser {
  id: string;
  role: UserRole;
  ownerId: string | null;
  assignedVenueIds: string[];
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as RequestUser;
  },
);
