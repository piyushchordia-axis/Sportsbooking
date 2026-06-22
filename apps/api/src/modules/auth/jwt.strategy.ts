import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole } from '@sportsbooking/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RequestUser } from '../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  ownerId: string | null;
  assignedVenueIds?: string[];
  /**
   * Present (and set to 'refresh') only on refresh tokens. Access tokens never
   * carry this claim — it lets the strategy reject a refresh token presented as
   * a Bearer access token.
   */
  type?: string;
}

const INSECURE_DEFAULT_SECRET = 'change-me-in-prod';
const DEV_FALLBACK_SECRET = 'dev-only-insecure-jwt-secret';

let cachedSecret: string | null = null;
let devWarningEmitted = false;

/**
 * Resolves the JWT secret exactly once and validates it.
 * In production, a missing or insecure default secret is a fatal startup error.
 * In development, falls back to a known dev secret with a one-time warning.
 */
export function resolveJwtSecret(config: ConfigService): string {
  if (cachedSecret !== null) {
    return cachedSecret;
  }

  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const configured = config.get<string>('JWT_SECRET');

  if (isProduction) {
    if (!configured || configured === INSECURE_DEFAULT_SECRET) {
      throw new Error(
        'JWT_SECRET must be set to a strong, non-default value in production.',
      );
    }
    cachedSecret = configured;
    return cachedSecret;
  }

  if (!configured) {
    if (!devWarningEmitted) {
      devWarningEmitted = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[auth] JWT_SECRET is not set; using an insecure development fallback. Set JWT_SECRET before deploying to production.',
      );
    }
    cachedSecret = DEV_FALLBACK_SECRET;
    return cachedSecret;
  }

  cachedSecret = configured;
  return cachedSecret;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(config),
    });
  }

  validate(payload: JwtPayload): RequestUser {
    // Refresh tokens are signed with the same secret but must never authenticate
    // a request as a Bearer access token. Access tokens carry a role and no
    // `type` claim; reject anything that looks like a refresh token (or any
    // token missing a role).
    if (payload.type === 'refresh' || !payload.role) {
      throw new UnauthorizedException('Invalid access token');
    }
    return {
      id: payload.sub,
      role: payload.role,
      ownerId: payload.ownerId,
      assignedVenueIds: payload.assignedVenueIds ?? [],
    };
  }
}
