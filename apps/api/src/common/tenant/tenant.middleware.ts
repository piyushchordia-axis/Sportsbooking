import { Injectable, NestMiddleware } from '@nestjs/common';
import { UserRole } from '@sportsbooking/shared';
import { NextFunction, Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { runWithTenant } from './tenant-context';

/**
 * Establishes the AsyncLocalStorage tenant store for the request lifetime so
 * PrismaService.withTenant() can set RLS session vars. Reads the JWT (if any)
 * to determine ownerId / bypass. Auth enforcement still happens in JwtAuthGuard;
 * this only seeds tenant context.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    let ownerId: string | null = null;
    let userId: string | null = null;
    let role: string | null = null;
    let bypassRls = false;

    if (header?.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify(header.slice(7));
        userId = payload.sub ?? null;
        role = payload.role ?? null;
        ownerId = payload.ownerId ?? null;
        bypassRls = payload.role === UserRole.SUPER_ADMIN;
      } catch {
        // invalid/expired token → unauthenticated context; guards will reject.
      }
    }

    runWithTenant({ ownerId, bypassRls, userId, role }, () => next());
  }
}
