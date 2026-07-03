/**
 * Lightweight, fire-and-forget client error/event telemetry. Posts a small JSON
 * payload to the API's POST /client-logs so a tester's "if logs can help" is
 * actually answerable (MOB-2 / BOOK-6).
 *
 * Hard guarantees:
 *  - NEVER throws into app code: every public fn is wrapped in try/catch.
 *  - Best-effort delivery: navigator.sendBeacon when available, else
 *    fetch(..., { keepalive: true }) so it survives page unload.
 *  - Field sizes are capped client-side (the server caps again defensively).
 */

// Mirror the API base-url convention used in apps/web/src/api/client.ts.
const BASE = '/api';

/** Cap any single string field so we never ship a megabyte of stack/message. */
const MAX_LEN = 4000;

type LogLevel = 'error' | 'event';

interface ClientLogPayload {
  level: LogLevel;
  message: string;
  stack?: string;
  name?: string;
  url: string;
  userAgent: string;
  context?: Record<string, unknown>;
  ts: string;
}

/** Truncate a string to MAX_LEN chars; tolerates non-string input. */
function clip(value: unknown): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s;
}

/** Best-effort send that survives page unload and never throws. */
function send(payload: ClientLogPayload): void {
  try {
    const url = `${BASE}/client-logs`;
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }
    // Fallback: keepalive lets the request outlive the page during unload.
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'include',
    }).catch(() => {
      /* swallow: telemetry must never surface a network error */
    });
  } catch {
    /* swallow: telemetry must never throw into app code */
  }
}

/** Report a caught/unhandled error with an optional context bag. */
export function logClientError(error: unknown, context?: Record<string, unknown>): void {
  try {
    const err = error as { message?: unknown; stack?: unknown; name?: unknown } | undefined;
    send({
      level: 'error',
      message: clip(err?.message ?? error),
      stack: err?.stack ? clip(err.stack) : undefined,
      name: err?.name ? clip(err.name) : undefined,
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      context,
      ts: new Date().toISOString(),
    });
  } catch {
    /* swallow */
  }
}

/** Report a named, non-error breadcrumb event (e.g. a booking-flow milestone). */
export function logClientEvent(name: string, data?: Record<string, unknown>): void {
  try {
    send({
      level: 'event',
      message: clip(name),
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      context: data,
      ts: new Date().toISOString(),
    });
  } catch {
    /* swallow */
  }
}
