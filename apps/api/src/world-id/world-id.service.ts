import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { signRequest } from '@worldcoin/idkit-server';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { randomBytes } from 'crypto';
import { DemoStateService } from '../demo/demo-state.service';
import { CLAIM_TOPICS } from '../issuer/claim-topics';
import { IssuerSigningService } from '../issuer/issuer-signing.service';
import {
  CHECK_TOPICS,
  WORLD_ENVIRONMENTS,
  type IdentityAttribute,
  type WorldCheck,
  type WorldEnvironment,
  type WorldRequestPayload,
} from './world-id.types';

type VerifierResponse = {
  success?: boolean;
  action?: string;
  nullifier?: string;
  environment?: string;
  code?: string;
  detail?: string;
  message?: string;
  results?: Array<{ identifier?: string; success?: boolean; nullifier?: string; code?: string; detail?: string }>;
};

/**
 * World ID Cloud verification. The browser only obtains a signed request and returns a proof;
 * World verifies that proof at its API before this service signs a PassportKit claim.
 *
 * Environment discipline (this is what broke the first attempt, PRs #11/#12):
 * the IDKit `environment`, the Developer Portal action's environment, and the device
 * completing the check MUST match. `production` = real World App on a phone,
 * `staging` = simulator.worldcoin.org only, `sandbox` = the sandbox World ID app
 * (the path for Selfie Check testing). A production phone against a staging request
 * "verifies" on the device but the proof can never pass the cloud verifier.
 */
@Injectable()
export class WorldIdService {
  private readonly logger = new Logger(WorldIdService.name);

  /**
   * Anti-replay: (action, nullifier) -> wallet that used it. In-memory is demo-grade;
   * production needs a DB UNIQUE (action, nullifier) constraint (NUMERIC(78,0)).
   */
  private readonly seenNullifiers = new Map<string, string>();

  constructor(
    private readonly signing: IssuerSigningService,
    private readonly demo: DemoStateService,
  ) {}

  get environment(): WorldEnvironment {
    const env = (process.env.WORLD_ENV ?? 'production') as WorldEnvironment;
    if (!WORLD_ENVIRONMENTS.includes(env)) {
      throw new BadRequestException(
        `WORLD_ENV must be one of ${WORLD_ENVIRONMENTS.join(', ')} (got "${env}")`,
      );
    }
    return env;
  }

  actionFor(check: WorldCheck): string {
    if (check === 'selfie') return process.env.WORLD_ACTION_SELFIE ?? 'passportkit-selfie';
    if (check === 'identity') return process.env.WORLD_ACTION_IDENTITY ?? 'passportkit-identity';
    return process.env.WORLD_ACTION ?? 'passportkit-verify';
  }

  /**
   * Identity Check (preview) attributes the widget must request. Kept server-side so the
   * widget and the verification policy can never drift apart.
   */
  identityAttributes(): IdentityAttribute[] {
    const minimumAge = parseInt(process.env.WORLD_IDENTITY_MINIMUM_AGE ?? '18', 10);
    return [
      { type: 'document_type', value: 'passport' },
      { type: 'minimum_age', value: minimumAge },
    ];
  }

  createRequest(check: WorldCheck): WorldRequestPayload {
    const appId = process.env.WORLD_APP_ID;
    const rpId = process.env.WORLD_RP_ID;
    const signingKeyHex = process.env.WORLD_RP_SIGNING_KEY;
    const action = this.actionFor(check);

    if (!appId || appId === 'app_' || !rpId || rpId === 'rp_' || !signingKeyHex || signingKeyHex === '0x') {
      throw new BadRequestException(
        'World ID is not configured. Set WORLD_APP_ID, WORLD_RP_ID and WORLD_RP_SIGNING_KEY in apps/api/.env.',
      );
    }

    const signed = signRequest({ signingKeyHex, action });
    return {
      check,
      app_id: appId,
      action,
      environment: this.environment,
      rp_context: {
        rp_id: rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
      ...(check === 'identity' ? { identity_attributes: this.identityAttributes() } : {}),
    };
  }

  async verifyAndPrepareClaim(
    wallet: Address,
    identity: Address,
    check: WorldCheck,
    idkitResponse: Record<string, unknown>,
  ) {
    const rpId = process.env.WORLD_RP_ID;
    const action = this.actionFor(check);
    if (!rpId) throw new BadRequestException('WORLD_RP_ID is not configured');

    // The proof is action-bound; a payload for another action can never satisfy this check.
    if (typeof idkitResponse.action === 'string' && idkitResponse.action !== action) {
      throw new BadRequestException(
        `This proof is for action "${idkitResponse.action}", expected "${action}" for the ${check} check.`,
      );
    }

    if (check === 'identity' && idkitResponse.identity_attested !== true) {
      throw new BadRequestException(
        'Identity Check did not attest the requested attributes (identity_attested is not true).',
      );
    }

    const verification = await this.callVerifier(rpId, idkitResponse);
    const nullifier = this.extractNullifier(verification, idkitResponse);
    this.guardReplay(action, nullifier, wallet);

    // Only a hash of the World action/nullifier reference enters claim data; no proof or PII is on-chain.
    const dataHash = keccak256(
      toHex(JSON.stringify({ provider: 'world-id', check, action, nullifier: nullifier ?? 'verified' })),
    ) as Hex;
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    // Selfie Check credentials are valid for 90 days; other checks keep the 1-year claim.
    const validitySeconds = check === 'selfie' ? 90 * 86400 : 365 * 86400;
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + validitySeconds);

    try {
      const claim = await this.signing.signClaim({
        identity,
        topic: CLAIM_TOPICS[CHECK_TOPICS[check]],
        dataHash,
        expiresAt,
        nonce,
      });
      return { mode: 'onchain' as const, verified: true, check, claim };
    } catch (error) {
      if (!this.demo.enabled) throw error;
      this.demo.markCheckVerified(wallet, check);
      this.logger.warn(
        `World ${check} proof verified, but no issuer key/contracts are configured: returning explicit MOCK result`,
      );
      return {
        mode: 'mock' as const,
        verified: true,
        check,
        message: `World ${check} proof verified. DEMO_MODE records a local status only; no claim was written on-chain.`,
      };
    }
  }

  private async callVerifier(
    rpId: string,
    idkitResponse: Record<string, unknown>,
  ): Promise<VerifierResponse> {
    let response: Response;
    let verification: VerifierResponse;
    try {
      response = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'passportkit-node' },
        // IDKit generates this payload; do not reshape the proof in the browser or server.
        body: JSON.stringify(idkitResponse),
      });
      verification = (await response.json()) as VerifierResponse;
    } catch (error) {
      this.logger.error('World ID verifier request failed', error instanceof Error ? error.stack : undefined);
      throw new BadGatewayException('Unable to reach the World ID verifier');
    }

    if (!response.ok || !verification.success) {
      // Surface the verifier's own diagnosis — a bare "it failed" is what hid the env mismatch in PR #11/#12.
      const resultCodes = (verification.results ?? [])
        .filter((r) => r.success === false && (r.code || r.detail))
        .map((r) => `${r.identifier ?? 'credential'}: ${r.code ?? ''} ${r.detail ?? ''}`.trim());
      const detail = [verification.code, verification.detail ?? verification.message, ...resultCodes]
        .filter(Boolean)
        .join(' — ');
      this.logger.warn(`World ID verifier rejected proof (HTTP ${response.status}): ${detail || 'no detail'}`);
      throw new BadRequestException(
        detail ? `World ID rejected this proof: ${detail}` : 'World ID rejected this proof',
      );
    }
    return verification;
  }

  private extractNullifier(
    verification: VerifierResponse,
    idkitResponse: Record<string, unknown>,
  ): string | null {
    if (verification.nullifier) return verification.nullifier;
    const fromResults = verification.results?.find((r) => r.nullifier)?.nullifier;
    if (fromResults) return fromResults;
    const responses = idkitResponse.responses;
    if (Array.isArray(responses)) {
      const first = (responses as Array<Record<string, unknown>>).find(
        (r) => typeof r?.nullifier === 'string',
      );
      if (first) return first.nullifier as string;
    }
    return null;
  }

  private guardReplay(action: string, nullifier: string | null, wallet: Address): void {
    if (!nullifier) return;
    const key = `${action}:${nullifier.toLowerCase()}`;
    const previous = this.seenNullifiers.get(key);
    if (previous && previous !== wallet.toLowerCase()) {
      throw new BadRequestException(
        'This World ID already verified this check for a different wallet.',
      );
    }
    this.seenNullifiers.set(key, wallet.toLowerCase());
  }
}
