import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates when a valid Bearer token is present but does NOT reject
 * anonymous requests — used for guest/walk-in booking with player capture
 * (PRD §4.3, §4.9). Pair with @Public() so the global JwtAuthGuard steps aside.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = unknown>(
    _err: unknown,
    user: TUser,
  ): TUser {
    return user || (undefined as TUser);
  }

  override canActivate(context: ExecutionContext) {
    // never blocks; just attempts to populate req.user
    return super.canActivate(context) as boolean | Promise<boolean>;
  }
}
