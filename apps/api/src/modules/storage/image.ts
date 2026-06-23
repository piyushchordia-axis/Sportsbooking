/**
 * Shared, security-first image validation for uploads. We trust the actual
 * file bytes (magic numbers), NEVER the client-supplied mimetype, and reject
 * anything that isn't a known raster image. SVG is intentionally excluded:
 * stored SVGs can carry inline scripts and become a stored-XSS vector when
 * served from our own origin.
 */

/** Accepted raster image MIME → file extension. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Sniff the leading bytes and return the canonical MIME type, or null when the
 * signature doesn't match a supported raster image.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Validate an uploaded image file (presence, size, real image bytes) and return
 * its canonical MIME + extension. Throws a human-readable message on failure
 * (callers wrap it in a BadRequestException).
 */
export function validateImageUpload(
  file: { size: number; buffer: Buffer } | undefined,
  maxBytes: number,
): { mime: string; ext: string } {
  if (!file) throw new Error('No file uploaded');
  if (file.size > maxBytes) {
    throw new Error(`Image must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller`);
  }
  const mime = sniffImageMime(file.buffer);
  const ext = mime ? IMAGE_TYPES[mime] : undefined;
  if (!mime || !ext) {
    throw new Error('Image must be a PNG, JPG, WebP or GIF');
  }
  return { mime, ext };
}
