import { Body, Controller, Post } from '@nestjs/common';
import { IsEthereumAddress, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { randomBytes } from 'crypto';
import { IssuerSigningService } from '../issuer/issuer-signing.service';
import { CLAIM_TOPICS, type ClaimTopicName } from '../issuer/claim-topics';
import { WorldService, type WorldKind, type WorldProof } from './world.service';

/** kind -> the real claim topic it proves. */
const TOPIC_FOR_KIND: Record<WorldKind, ClaimTopicName> = {
  selfie: 'PROOF_OF_PERSONHOOD',
  document: 'KYC_VERIFIED',
};

class WorldProofDto implements WorldProof {
  @IsString() merkle_root!: string;
  @IsString() nullifier_hash!: string;
  @IsString() proof!: string;
  @IsOptional() @IsString() verification_level?: string;
}

class WorldVerifyDto {
  @IsEthereumAddress()
  identity!: Address;

  @IsIn(['selfie', 'document'])
  kind!: WorldKind;

  @IsObject()
  proof!: WorldProofDto;
}

/**
 * WorldController — World ID proof -> signed claim (Model B).
 *
 * The demo's ONE real verification. It validates the World proof, then reuses IssuerSigningService to
 * sign the matching claim; the USER submits it to their own Identity (we never write for them). Zero
 * PII: the on-chain data anchors to keccak256({ world, kind, nullifier }), a hash — never PII.
 *
 * Unlike /issuer/mock-claim this is NOT DEMO_MODE-gated: a real World proof IS the authorization. When
 * WORLD_APP_ID is unset the service degrades to a labeled mock only inside DEMO_MODE.
 */
@Controller('world')
export class WorldController {
  constructor(
    private readonly world: WorldService,
    private readonly signing: IssuerSigningService,
  ) {}

  @Post('verify')
  async verify(@Body() dto: WorldVerifyDto) {
    const result = await this.world.verify(dto.kind, dto.proof);

    const topicName = TOPIC_FOR_KIND[dto.kind];
    // Sanitized reference: a hash of the flow + nullifier. NEVER PII, never the proof.
    const evidence = JSON.stringify({
      world: true,
      kind: dto.kind,
      nullifier: result.nullifierHash,
    });
    const dataHash = keccak256(toHex(evidence)) as Hex;
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400);

    const signed = await this.signing.signClaim({
      identity: dto.identity,
      topic: CLAIM_TOPICS[topicName],
      dataHash,
      expiresAt,
      nonce,
    });

    // Everything the frontend needs for Identity.submitClaim(topic, issuer, sig, data):
    return {
      world: true,
      mock: result.mock,
      kind: dto.kind,
      topicName,
      topic: signed.topic.toString(),
      issuer: signed.issuer,
      signature: signed.signature,
      data: signed.data,
    };
  }
}
