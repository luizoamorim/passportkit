import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WorldModule } from './world/world.module';
import { IssuerModule } from './issuer/issuer.module';
import { IdentityModule } from './identity/identity.module';
import { HeroModule } from './hero/hero.module';

/**
 * TEST/DEMO bootstrap for the guided hero flow — boots ONLY the modules the flow needs (World, Issuer,
 * Identity, Hero) with NO Prisma / Postgres, so the whole Sepolia journey runs without a database.
 * Not the product boot path (that is main.ts / AppModule). Run:
 *   npx ts-node-dev --respawn --transpile-only -r tsconfig-paths/register src/hero-main.ts
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WorldModule,
    IssuerModule,
    IdentityModule,
    HeroModule,
  ],
})
class HeroOnlyModule {}

async function bootstrap() {
  const app = await NestFactory.create(HeroOnlyModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }));
  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`[hero] API on ${port} — /hero/provision, /hero/link-agent, /world/*, /issuer/*, /identity/*`);
}

bootstrap();
