/**
 * Boot-time environment validation (wired into ConfigModule.forRoot).
 *
 * Fail fast on a misconfigured environment instead of discovering it lazily at
 * the first query / payment / upload. This complements the dedicated runtime
 * guards (JWT_SECRET in jwt.strategy, SMS in notification.service) — it covers
 * the structural gaps the audit flagged: DATABASE_URL, and half-configured
 * Razorpay / storage. Kept as a plain function (no new deps).
 */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isSet = (v: unknown): boolean => str(v).length > 0;

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  // Always required — the app cannot run without a database.
  if (!isSet(config.DATABASE_URL)) {
    errors.push('DATABASE_URL is required');
  }

  // NODE_ENV, if set, must be a known value (a typo silently disables prod guards).
  if (isSet(config.NODE_ENV) &&
    !['development', 'production', 'test'].includes(str(config.NODE_ENV))) {
    errors.push(
      `NODE_ENV must be one of development|production|test (got "${str(config.NODE_ENV)}")`,
    );
  }

  // Ports must be numeric when provided.
  for (const key of ['API_PORT']) {
    if (isSet(config[key]) && Number.isNaN(Number(config[key]))) {
      errors.push(`${key} must be a number (got "${str(config[key])}")`);
    }
  }

  // Razorpay: all three keys together, or none — a half-configured gateway takes
  // real money without being able to verify signatures/refunds.
  const rz = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];
  const rzSet = rz.filter((k) => isSet(config[k]));
  if (rzSet.length > 0 && rzSet.length < rz.length) {
    errors.push(
      `Razorpay keys must be set together or all unset (missing: ${rz.filter((k) => !isSet(config[k])).join(', ')})`,
    );
  }

  // S3 storage: if a bucket is configured, the credentials + region are required
  // (else uploads fail at runtime with a cryptic AWS error). The local-disk
  // driver (no bucket) needs none of these.
  if (isSet(config.STORAGE_BUCKET)) {
    for (const key of [
      'STORAGE_REGION',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY',
    ]) {
      if (!isSet(config[key])) {
        errors.push(`${key} is required when STORAGE_BUCKET is set (S3 mode)`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }
  return config;
}
