import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS_ORIGIN may be a comma-separated list (prod + Vercel preview domains).
  // Trailing slashes are stripped because enableCors compares the Origin header EXACTLY, and a
  // browser sends "https://host" with no trailing slash — so a pasted "https://host/" silently
  // blocks every request with a CORS error that looks nothing like a config typo.
  const corsOrigin = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  app.enableCors({ origin: corsOrigin, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`PassportCreds API listening on port ${port}`);
}

bootstrap();
