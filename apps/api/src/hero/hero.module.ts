import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { HeroService } from './hero.service';
import { HeroController } from './hero.controller';

@Module({
  imports: [IdentityModule], // reuses IdentityService.createIdentity
  controllers: [HeroController],
  providers: [HeroService],
  exports: [HeroService],
})
export class HeroModule {}
