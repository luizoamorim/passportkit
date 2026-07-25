import { Body, Controller, Post } from '@nestjs/common';
import { IsEthereumAddress, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { type Address } from 'viem';
import {
  IdentityService,
  type CreateIdentityResult,
  type LinkAgentResult,
  type UnlinkAgentResult,
} from './identity.service';

class CreateIdentityDto {
  @IsEthereumAddress()
  wallet!: Address;
}

class LinkAgentDto {
  @IsEthereumAddress()
  agentWallet!: Address;

  @IsOptional()
  @IsEthereumAddress()
  personWallet?: Address; // resolved to the person's identity via IdentityFactory

  @IsOptional()
  @IsEthereumAddress()
  personIdentity?: Address; // or pass the identity directly

  // ENS label for the agent subname (e.g. "bot1" -> bot1.casaazul.eth). Lowercase, ENS-safe.
  @IsString()
  @MaxLength(63)
  @Matches(/^[a-z0-9-]+$/, { message: 'label must be lowercase a-z, 0-9 or -' })
  label!: string;
}

class UnlinkAgentDto {
  @IsEthereumAddress()
  agentWallet!: Address;
}

/**
 * IdentityController — provisions user identities and links x402 agents.
 *
 * `POST /identity/create { wallet }` — the backend (agent key) deploys the user's Identity via
 * IdentityFactory; the USER's wallet is its MANAGEMENT key (Model B). Idempotent.
 *
 * `POST /identity/link-agent { agentWallet, personWallet|personIdentity, label }` — links an agent
 * to a person's identity (Model A) AND issues its ENS subname in one call. After this the agent
 * inherits the person's eligibility and its subname resolves compliance + the ENSIP-25
 * `agent-registration` record + `agent.reputation` live. `POST /identity/unlink-agent` reverses it.
 *
 * Not DEMO_MODE-gated: these are real onboarding paths (unlike /issuer/mock-claim + revoke, which
 * wield issuer/agent power over compliance).
 */
@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('create')
  create(@Body() dto: CreateIdentityDto): Promise<CreateIdentityResult> {
    return this.identity.createIdentity(dto.wallet);
  }

  @Post('link-agent')
  linkAgent(@Body() dto: LinkAgentDto): Promise<LinkAgentResult> {
    return this.identity.linkAgent({
      agentWallet: dto.agentWallet,
      personWallet: dto.personWallet,
      personIdentity: dto.personIdentity,
      label: dto.label,
    });
  }

  @Post('unlink-agent')
  unlinkAgent(@Body() dto: UnlinkAgentDto): Promise<UnlinkAgentResult> {
    return this.identity.unlinkAgent(dto.agentWallet);
  }
}
