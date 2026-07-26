import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorldModule } from './world/world.module';

/**
 * TEST-ONLY bootstrap: boots ONLY the World module (+ the issuer signing it reuses), with NO Prisma /
 * Postgres — so the World ID flow can be exercised end-to-end without a database. Not part of the
 * product boot path (that is main.ts / AppModule). Run: `npx ts-node --transpile-only -r
 * tsconfig-paths/register src/world-main.ts`.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), WorldModule],
})
class WorldOnlyModule {}

async function bootstrap() {
  const app = await NestFactory.create(WorldOnlyModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }));
  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`[world-only] API listening on ${port} — /world/request, /world/verify`);
}

bootstrap();
