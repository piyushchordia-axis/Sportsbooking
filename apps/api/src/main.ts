import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { StorageService } from './modules/storage/storage.service';

async function bootstrap() {
  // rawBody: true preserves the unparsed request body so the Razorpay webhook
  // can verify the HMAC signature against the exact bytes Razorpay signed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const isProd = process.env.NODE_ENV === 'production';

  // In production the API sits behind two reverse proxies (the host's public
  // Nginx → the web-tier Nginx), so trust the proxy chain to recover the real
  // client IP + scheme for rate-limiting, secure cookies, and logging. Two hops
  // by default; override with TRUST_PROXY (a hop count or an Express value).
  const trustProxy = process.env.TRUST_PROXY ?? (isProd ? '2' : undefined);
  if (trustProxy !== undefined) {
    const hops = Number(trustProxy);
    app.set('trust proxy', Number.isFinite(hops) ? hops : trustProxy);
  }

  // Security headers (M1/M2). Registered first so it also covers static
  // /uploads responses. The CSP sets `script-src 'none'` / `object-src 'none'`
  // so a stored SVG (or any HTML) served from the API origin cannot execute
  // script even on direct navigation (defence-in-depth for the logo upload).
  // crossOriginResourcePolicy is relaxed to cross-origin so the white-label SPA
  // (a different origin) can still embed owner logos via <img>.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          scriptSrc: ["'none'"],
          objectSrc: ["'none'"],
          'frame-ancestors': ["'none'"],
        },
      },
    }),
  );

  // Parse cookies so the auth controller can read the httpOnly refresh-token
  // cookie (the refresh token is no longer kept in browser-accessible storage).
  app.use(cookieParser());

  app.setGlobalPrefix('api');

  // Local storage driver (dev): serve uploaded files from disk. With the s3/R2
  // driver this returns null and assets are served by the bucket/CDN instead.
  // nosniff stops content-type sniffing of uploaded files.
  const mount = app.get(StorageService).localMount();
  if (mount) {
    app.useStaticAssets(mount.dir, {
      prefix: mount.prefix,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    });
  }

  // CORS: in production restrict to an allowlist from WEB_ORIGIN
  // (comma-separated). Fail CLOSED — if production is misconfigured with no
  // WEB_ORIGIN we refuse all cross-origin requests rather than reflecting any
  // origin. In dev, keep the permissive origin so local dev (Vite) just works.
  const allowlist = (process.env.WEB_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const corsOrigin: boolean | string[] = isProd
    ? allowlist.length > 0
      ? allowlist
      : false
    : true;
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.API_PORT ?? 3001;
  // With host networking in production, HOST=127.0.0.1 binds loopback only so
  // the API is not publicly exposed — the host Nginx + web tier reach it via
  // 127.0.0.1. Defaults to 0.0.0.0 for dev / bridge networking.
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://${host}:${port}/api`);
}

void bootstrap();
