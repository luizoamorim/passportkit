import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsEthereumAddress, IsObject, IsOptional } from 'class-validator';
import { type Address } from 'viem';
import { WorldIdService } from './world-id.service';

class VerifyWorldIdDto {
  @IsEthereumAddress()
  wallet!: Address;

  @IsEthereumAddress()
  identity!: Address;

  @IsObject()
  idkitResponse!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/** World ID endpoints belong to the new API; proofs are always checked server-side. */
@Controller('world-id')
export class WorldIdController {
  constructor(private readonly worldId: WorldIdService) {}

  @Post('request')
  createRequest() {
    return this.worldId.createRequest();
  }

  @Post('identity/request')
  createIdentityRequest() {
    return this.worldId.createIdentityRequest();
  }

  /** Separate Selfie Check Beta request; it does not change Identity Check. */
  @Post('selfie/request')
  createSelfieRequest() {
    return this.worldId.createSelfieRequest();
  }

  @Post('verify')
  verify(@Body() dto: VerifyWorldIdDto) {
    return this.worldId.verifyAndPrepareClaim(dto.wallet, dto.identity, dto.idkitResponse);
  }

  @Post('identity/verify')
  @HttpCode(HttpStatus.OK)
  verifyIdentity(@Body() dto: VerifyWorldIdDto) {
    return this.worldId.verifyIdentityAndPrepareClaim(dto.wallet, dto.identity, dto.idkitResponse);
  }

  @Post('selfie/verify')
  @HttpCode(HttpStatus.OK)
  verifySelfie(@Body() dto: VerifyWorldIdDto) {
    return this.worldId.verifySelfieAndPrepareClaim(dto.wallet, dto.identity, dto.idkitResponse);
  }
}
