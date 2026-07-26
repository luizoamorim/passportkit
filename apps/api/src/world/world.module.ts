import { Module } from '@nestjs/common';
import { IssuerModule } from '../issuer/issuer.module';
import { WorldService } from './world.service';
import { WorldController } from './world.controller';

@Module({
  imports: [IssuerModule], // exports IssuerSigningService
  controllers: [WorldController],
  providers: [WorldService],
  exports: [WorldService],
})
export class WorldModule {}
