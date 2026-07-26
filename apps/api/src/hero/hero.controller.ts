import { Body, Controller, Post } from '@nestjs/common';
import { IsEthereumAddress, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { type Address } from 'viem';
import { HeroService, type LinkAgentResult, type ProvisionResult } from './hero.service';

const LABEL = /^[a-zA-Z0-9-]{1,32}$/;

class ProvisionDto {
  @IsEthereumAddress()
  wallet!: Address;

  @Matches(LABEL, { message: 'label must be 1-32 chars [a-zA-Z0-9-]' })
  label!: string;
}

class LinkAgentDto {
  @IsEthereumAddress()
  agentWallet!: Address;

  @IsEthereumAddress()
  personIdentity!: Address;

  @Matches(LABEL, { message: 'label must be 1-32 chars [a-zA-Z0-9-]' })
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}

/**
 * HeroController — the guided Sepolia demo's provisioning endpoints.
 *
 * `POST /hero/provision` bundles identity creation + gas drip + LIVE ENS subname binding (step 2).
 * `POST /hero/link-agent` links an agent wallet (Model A), binds bot.<label>, sets reputation, funds it
 * with gas + Casa Azul tokens (step 5). The USER still submits their own claims (Model B) via /world +
 * /issuer; these only provision containers, ENS and funding using the agent (controller) key.
 */
@Controller('hero')
export class HeroController {
  constructor(private readonly hero: HeroService) {}

  @Post('provision')
  provision(@Body() dto: ProvisionDto): Promise<ProvisionResult> {
    return this.hero.provisionUser({ wallet: dto.wallet, label: dto.label });
  }

  @Post('link-agent')
  linkAgent(@Body() dto: LinkAgentDto): Promise<LinkAgentResult> {
    return this.hero.linkAgent({
      agentWallet: dto.agentWallet,
      personIdentity: dto.personIdentity,
      label: dto.label,
      score: dto.score,
    });
  }
}
