import { Module } from '@nestjs/common';
import { IssuerSigningService } from './issuer-signing.service';
import { IssuerController } from './issuer.controller';

@Module({
  controllers: [IssuerController],
  providers: [IssuerSigningService],
  exports: [IssuerSigningService],
})
export class IssuerModule {}
