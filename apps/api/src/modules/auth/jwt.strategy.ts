import { Injectable } from '@nestjs/common';
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
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'change-me-in-prod'),
    });
  }

  validate(payload: JwtPayload): RequestUser {
    return {
      id: payload.sub,
      role: payload.role,
      ownerId: payload.ownerId,
      assignedVenueIds: payload.assignedVenueIds ?? [],
    };
  }
}
