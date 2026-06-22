import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';

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
