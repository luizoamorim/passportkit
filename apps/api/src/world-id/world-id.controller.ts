import { Body, Controller, Post } from '@nestjs/common';
import { IsEthereumAddress, IsIn, IsObject, IsOptional } from 'class-validator';
import { type Address } from 'viem';
import { WorldIdService } from './world-id.service';
import { WORLD_CHECKS, type WorldCheck } from './world-id.types';

class RequestWorldIdDto {
  @IsOptional()
  @IsIn(WORLD_CHECKS)
  check?: WorldCheck;
}

class VerifyWorldIdDto {
  @IsEthereumAddress()
  wallet!: Address;

  @IsEthereumAddress()
  identity!: Address;

  @IsOptional()
  @IsIn(WORLD_CHECKS)
  check?: WorldCheck;

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
  createRequest(@Body() dto: RequestWorldIdDto) {
    return this.worldId.createRequest(dto.check ?? 'personhood');
  }

  @Post('verify')
  verify(@Body() dto: VerifyWorldIdDto) {
    return this.worldId.verifyAndPrepareClaim(
      dto.wallet,
      dto.identity,
      dto.check ?? 'personhood',
      dto.idkitResponse,
    );
  }
}
