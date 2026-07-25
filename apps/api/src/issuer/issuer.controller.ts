import { Body, Controller, Get, Post } from '@nestjs/common';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { randomBytes } from 'crypto';
import { IssuerSigningService } from './issuer-signing.service';
import { CLAIM_TOPICS, type ClaimTopicName } from './claim-topics';

interface MockClaimDto {
  identity: Address;
  topic: ClaimTopicName;
  approved?: boolean; // default true; false = evidence rejected, no claim issued
  expiresInDays?: number; // default 365; 0 = no expiry
}

/**
 * IssuerController — evidence -> signed claim.
 *
 * `/issuer/mock-claim` is the LABELED MOCK evidence handler (KYC / accredited placeholders — never
 * real KYC). The World handler (other dev) follows the SAME shape: validate the World proof, then
 * call `signing.signClaim(...)`. Model B: we return (signature, data); the USER submits the claim.
 */
@Controller('issuer')
export class IssuerController {
  constructor(private readonly signing: IssuerSigningService) {}

  @Get('signer')
  signer() {
    return { signer: this.signing.signerAddress };
  }

  @Post('mock-claim')
  async mockClaim(@Body() dto: MockClaimDto) {
    const approved = dto.approved ?? true;
    if (!approved) {
      // Rejected evidence => no claim. (KYC FAILED = no valid claim = not eligible.)
      return { mock: true, approved: false, message: 'evidence rejected — no claim issued' };
    }

    // Sanitized MOCK evidence -> a hash. NEVER PII. Clearly labeled.
    const mockEvidence = JSON.stringify({ mock: true, topic: dto.topic, approved: true });
    const dataHash = keccak256(toHex(mockEvidence)) as Hex;
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    const days = dto.expiresInDays ?? 365;
    const expiresAt = days === 0 ? 0n : BigInt(Math.floor(Date.now() / 1000) + days * 86400);

    const signed = await this.signing.signClaim({
      identity: dto.identity,
      topic: CLAIM_TOPICS[dto.topic],
      dataHash,
      expiresAt,
      nonce,
    });

    // Everything the frontend needs for Identity.submitClaim(topic, issuer, sig, data):
    return {
      mock: true,
      approved: true,
      topic: signed.topic.toString(),
      issuer: signed.issuer,
      signature: signed.signature,
      data: signed.data,
    };
  }
}
