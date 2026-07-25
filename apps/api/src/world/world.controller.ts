import { Body, Controller, Post } from '@nestjs/common';
import { IsEthereumAddress, IsIn, IsObject, IsOptional } from 'class-validator';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { randomBytes } from 'crypto';
import { IssuerSigningService } from '../issuer/issuer-signing.service';
import { CLAIM_TOPICS, type ClaimTopicName } from '../issuer/claim-topics';
import { WorldService, type WorldKind, type WorldResult } from './world.service';

/** kind -> the real claim topic it proves. */
const TOPIC_FOR_KIND: Record<WorldKind, ClaimTopicName> = {
  selfie: 'PROOF_OF_PERSONHOOD',
  document: 'KYC_VERIFIED',
};

class WorldRequestDto {
  @IsIn(['selfie', 'document'])
  kind!: WorldKind;
}

class WorldVerifyDto {
  @IsEthereumAddress()
  identity!: Address;

  @IsIn(['selfie', 'document'])
  kind!: WorldKind;

  @IsObject()
  result!: WorldResult; // the IDKitResult from the widget (Groth16 proof — never PII)

  @IsOptional()
  @IsObject()
  rp_context?: Record<string, unknown>; // echoed back for reference; validation uses `result`
}

/**
 * WorldController — World ID v4 flow (Model B).
 *
 * Two steps mirror the v4 RP-signature handshake:
 *   POST /world/request { kind }          -> { app_id, action, rp_context }  (RP-signed; open the widget)
 *   POST /world/verify  { identity, kind, result } -> a signed claim the USER submits to their Identity
 *
 * The demo's ONE real verification. Zero PII: the on-chain data anchors to
 * keccak256({ world, kind, nullifier }) — a hash, never PII. Not DEMO_MODE-gated: a real World proof IS
 * the authorization; when keys are unset the service degrades to a labeled mock only inside DEMO_MODE.
 */
@Controller('world')
export class WorldController {
  constructor(
    private readonly world: WorldService,
    private readonly signing: IssuerSigningService,
  ) {}

  @Post('request')
  request(@Body() dto: WorldRequestDto) {
    return this.world.buildRequest(dto.kind);
  }

  @Post('verify')
  async verify(@Body() dto: WorldVerifyDto) {
    const verified = this.world.verifyResult(dto.kind, dto.result);

    const topicName = TOPIC_FOR_KIND[dto.kind];
    // Sanitized reference: a hash of the flow + nullifier. NEVER PII, never the proof.
    const evidence = JSON.stringify({
      world: true,
      kind: dto.kind,
      nullifier: verified.nullifierHash,
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
      mock: verified.mock,
      kind: dto.kind,
      credential: verified.credential,
      topicName,
      topic: signed.topic.toString(),
      issuer: signed.issuer,
      signature: signed.signature,
      data: signed.data,
    };
  }
}
