import { Injectable, Logger } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { resolveStorageConfig, type StorageConfig } from './storage.config';

export interface StoredObject {
  /** The object key (path within the bucket / local dir). */
  key: string;
  /** The public URL where the object can be fetched. */
  url: string;
}

/**
 * Generic object storage. One interface, two drivers:
 *  - `s3`: any S3-compatible store — Amazon S3 OR Cloudflare R2 (set
 *    STORAGE_ENDPOINT to the R2 endpoint) — via the AWS S3 SDK.
 *  - `local`: writes to disk and is served by the API at /uploads (dev/test, no
 *    cloud account needed).
 * Swapping providers is pure configuration; callers never change.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly config: StorageConfig;
  private readonly s3?: S3Client;

  constructor() {
    this.config = resolveStorageConfig();
    if (this.config.driver === 's3') {
      this.s3 = new S3Client({
        region: this.config.region,
        endpoint: this.config.endpoint,
        forcePathStyle: this.config.forcePathStyle,
        credentials: {
          accessKeyId: this.config.accessKeyId!,
          secretAccessKey: this.config.secretAccessKey!,
        },
      });
      this.logger.log(
        `Storage: s3-compatible (bucket=${this.config.bucket}${this.config.endpoint ? `, endpoint=${this.config.endpoint}` : ''})`,
      );
    } else {
      this.logger.log(`Storage: local disk (${this.config.localDir})`);
    }
  }

  /** Local static mount for main.ts (null when using the s3 driver). */
  localMount(): { dir: string; prefix: string } | null {
    return this.config.driver === 'local'
      ? { dir: this.config.localDir, prefix: this.config.localPrefix }
      : null;
  }

  /** Store an object under `key` and return its public URL. */
  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    const cleanKey = key.replace(/^\/+/, '');
    if (this.config.driver === 's3') {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: cleanKey,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } else {
      const dest = join(this.config.localDir, cleanKey);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, body);
    }
    return { key: cleanKey, url: `${this.config.publicBaseUrl}/${cleanKey}` };
  }

  /** Best-effort delete (e.g. replacing an old logo). Never throws. */
  async delete(key: string): Promise<void> {
    const cleanKey = key.replace(/^\/+/, '');
    try {
      if (this.config.driver === 's3') {
        await this.s3!.send(
          new DeleteObjectCommand({
            Bucket: this.config.bucket,
            Key: cleanKey,
          }),
        );
      } else {
        await unlink(join(this.config.localDir, cleanKey));
      }
    } catch {
      /* best-effort: a missing object is not an error */
    }
  }

  /**
   * Recover the object key from a public URL we previously returned, so an old
   * asset can be deleted. Returns null when the URL isn't one of ours.
   */
  keyFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const base = `${this.config.publicBaseUrl}/`;
    return url.startsWith(base) ? url.slice(base.length) : null;
  }
}
