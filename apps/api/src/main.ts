import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { StorageService } from './modules/storage/storage.service';

async function bootstrap() {
  // rawBody: true preserves the unparsed request body so the Razorpay webhook
  // can verify the HMAC signature against the exact bytes Razorpay signed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.setGlobalPrefix('api');

  // Local storage driver (dev): serve uploaded files from disk. With the s3/R2
  // driver this returns null and assets are served by the bucket/CDN instead.
  const mount = app.get(StorageService).localMount();
  if (mount) {
    app.useStaticAssets(mount.dir, { prefix: mount.prefix });
  }

  // In production, restrict CORS to an allowlist from WEB_ORIGIN (comma-separated)
  // instead of reflecting any origin. In dev, keep the permissive origin so local
  // dev (Vite, etc.) keeps working without configuration.
  const isProd = process.env.NODE_ENV === 'production';
  const allowlist = (process.env.WEB_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const corsOrigin: boolean | string[] =
    isProd && allowlist.length > 0 ? allowlist : true;
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}/api`);
}

void bootstrap();
