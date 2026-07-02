import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';

/** Cap any single field so a hostile/oversized payload can't bloat the logs. */
const MAX_LEN = 4000;

/**
 * Raw, untrusted shape posted by the web client's telemetry helper
 * (apps/web/src/lib/telemetry.ts). Everything is optional/unknown by design;
 * we coerce + size-cap defensively before logging and NEVER echo it back.
 */
interface ClientLogBody {
  level?: unknown;
  message?: unknown;
  stack?: unknown;
  name?: unknown;
  url?: unknown;
  userAgent?: unknown;
  context?: unknown;
  ts?: unknown;
}

/** Coerce to a string and hard-cap its length (drops non-string input). */
function clip(value: unknown): string {
  const s = typeof value === 'string' ? value : '';
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

/**
 * Public sink for client-side error telemetry (MOB-2 / BOOK-6). Writes ONE
 * structured Logger line per report so a tester's crash is greppable in the
 * server logs. No DB writes, no auth (by design — it must accept reports from
 * logged-out users mid-crash), and abuse-resistant: every field is size-capped
 * and nothing is echoed back to the caller.
 *
 * @Public so the global JwtAuthGuard lets it through. A generous per-IP throttle
 * (120/min) replaces the previous @SkipThrottle: it still absorbs an incident
 * burst but bounds an attacker from flooding the server logs / filling the disk.
 * Reachable at POST /api/client-logs (global prefix applied).
 */
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('client-logs')
export class ClientLogsController {
  private readonly logger = new Logger('ClientLog');

  @Public()
  @Post()
  @HttpCode(204)
  ingest(@Body() body: ClientLogBody): void {
    // Defensive: ignore anything that isn't a JSON object.
    if (!body || typeof body !== 'object') return;

    const level = body.level === 'event' ? 'event' : 'error';
    const message = clip(body.message);
    const url = clip(body.url);
    const userAgent = clip(body.userAgent);
    const name = clip(body.name);
    const stack = clip(body.stack);
    // Re-serialize context through JSON so we only log plain data, capped.
    let context = '';
    try {
      if (body.context !== undefined) context = clip(JSON.stringify(body.context));
    } catch {
      context = '';
    }

    const line =
      `[${level}] ${name ? `${name}: ` : ''}${message}` +
      ` | url=${url} | ua=${userAgent}` +
      (context ? ` | context=${context}` : '') +
      (stack ? ` | stack=${stack}` : '');

    this.logger.warn(line);
  }
}
