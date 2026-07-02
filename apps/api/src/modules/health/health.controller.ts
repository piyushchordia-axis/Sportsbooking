import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { Public } from '../../common/decorators/public.decorator';
import { DbService } from '../../db/db.service';

/**
 * Liveness probe for the container/orchestrator (Docker HEALTHCHECK, the host
 * Nginx, uptime monitors). Deliberately does NOT touch the database: it answers
 * "is the Node process up and serving HTTP?". A DB outage is surfaced by the
 * real endpoints, not by killing the container on a transient blip.
 *
 * @Public so the global JwtAuthGuard lets it through unauthenticated;
 * @SkipThrottle so frequent probes never eat into the rate-limit budget.
 * Reachable at GET /api/healthz (global prefix applied).
 */
@SkipThrottle()
@Controller('healthz')
export class HealthController {
  private readonly startedAt = Date.now();

  @Public()
  @Get()
  check(): { status: 'ok'; uptimeSeconds: number } {
    return {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }
}

/**
 * Readiness probe (GET /api/readyz): unlike /healthz, this DOES touch the DB
 * (a trivial `SELECT 1`) so a monitor / load balancer can tell "up but can't
 * serve" from "up and ready". Returns 503 if the DB is unreachable. The DB error
 * is logged server-side, never returned (this endpoint is @Public). Kept out of
 * the container HEALTHCHECK on purpose — a transient DB blip shouldn't kill the
 * app container (that's what /healthz is for).
 */
@SkipThrottle()
@Controller('readyz')
export class ReadinessController {
  private readonly logger = new Logger(ReadinessController.name);

  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ready'; db: 'up' }> {
    try {
      await this.db.db.execute(sql`SELECT 1`);
      return { status: 'ready', db: 'up' };
    } catch (err) {
      this.logger.error(
        `Readiness DB check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException({ status: 'not_ready', db: 'down' });
    }
  }
}
