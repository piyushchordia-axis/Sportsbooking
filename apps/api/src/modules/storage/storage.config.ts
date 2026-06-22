import { resolve } from 'node:path';

/**
 * Resolved storage configuration. The same `s3` driver talks to BOTH Amazon S3
 * and Cloudflare R2 (and any S3-compatible store) — R2 just needs STORAGE_ENDPOINT
 * set to the account endpoint and path-style addressing. When no bucket/keys are
 * configured (dev/test) the `local` driver writes to disk and the API serves the
 * files, so the upload flow is exercisable without any cloud account.
 */
export interface StorageConfig {
  driver: 's3' | 'local';
  bucket?: string;
  region: string;
  /** Custom endpoint — set for R2 (https://<account>.r2.cloudflarestorage.com). Empty for AWS S3. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** R2 (and many S3-compatibles) require path-style addressing. */
  forcePathStyle: boolean;
  /** Public base URL prepended to the object key (a CDN/CloudFront, R2 public domain, or the local /uploads mount). */
  publicBaseUrl: string;
  /** Local driver only: absolute directory files are written to. */
  localDir: string;
  /** Local driver only: the static mount path (e.g. /uploads). */
  localPrefix: string;
}

const PORT = process.env.API_PORT ?? '3001';

function trimTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

export function resolveStorageConfig(): StorageConfig {
  const bucket = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const endpoint = process.env.STORAGE_ENDPOINT || undefined;
  const region = process.env.STORAGE_REGION || 'auto';

  const localPrefix = process.env.STORAGE_LOCAL_PREFIX || '/uploads';
  const localDir = resolve(
    process.cwd(),
    process.env.STORAGE_LOCAL_DIR || 'uploads',
  );

  // Use the S3-compatible driver only when fully configured; otherwise fall back
  // to local disk so dev/test never needs cloud credentials.
  const useS3 = Boolean(bucket && accessKeyId && secretAccessKey);

  if (useS3) {
    // Public URL: an explicit CDN/public domain when given, else best-effort from
    // the endpoint/bucket (works for path-style S3-compatible stores).
    const explicit = process.env.STORAGE_PUBLIC_BASE_URL;
    const publicBaseUrl = explicit
      ? trimTrailingSlash(explicit)
      : endpoint
        ? `${trimTrailingSlash(endpoint)}/${bucket}`
        : `https://${bucket}.s3.${region}.amazonaws.com`;
    return {
      driver: 's3',
      bucket,
      region,
      endpoint,
      accessKeyId,
      secretAccessKey,
      // Path-style is required by R2 and most non-AWS S3-compatibles; default it
      // on whenever a custom endpoint is set, overridable via env.
      forcePathStyle:
        process.env.STORAGE_FORCE_PATH_STYLE != null
          ? process.env.STORAGE_FORCE_PATH_STYLE === 'true'
          : Boolean(endpoint),
      publicBaseUrl,
      localDir,
      localPrefix,
    };
  }

  const publicBaseUrl = trimTrailingSlash(
    process.env.STORAGE_LOCAL_BASE_URL || `http://localhost:${PORT}${localPrefix}`,
  );
  return {
    driver: 'local',
    region,
    forcePathStyle: true,
    publicBaseUrl,
    localDir,
    localPrefix,
  };
}
