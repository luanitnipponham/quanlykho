import './env';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });

  // Behind nginx (Docker) the client address arrives in X-Forwarded-For; without this
  // every request would look like it came from the proxy and rate limiting would be useless.
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');

  // The API serves JSON only, so the strictest CSP is fine here; nginx sets the
  // headers for the HTML app itself (deploy/nginx.conf).
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
  console.log(`[api] HỆ THỐNG PHIẾU YÊU CẦU CHI v3.4 — http://localhost:${port}/api/v1`);
}

void bootstrap();
