import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { signRequest } from '@worldcoin/idkit-server';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import { randomBytes } from 'crypto';
import { DemoStateService } from '../demo/demo-state.service';
import { CLAIM_TOPICS } from '../issuer/claim-topics';
import { IssuerSigningService } from '../issuer/issuer-signing.service';

type RpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

type WorldEnvironment = 'staging' | 'sandbox';

type SanitizedVerifierResponse = {
  success?: boolean;
  message?: string;
  code?: string;
  detail?: string;
  attribute?: string;
  request_id?: string;
  results?: Array<{ identifier?: string; success?: boolean; code?: string; detail?: string }>;
};

/**
 * World ID Cloud verification. The browser only obtains a signed request and returns a proof;
 * World verifies that proof at its API before this service signs a PassportKit claim.
 */
@Injectable()
export class WorldIdService {
  private readonly logger = new Logger(WorldIdService.name);

  constructor(
    private readonly signing: IssuerSigningService,
    private readonly demo: DemoStateService,
  ) {}

  createRequest(): { app_id: string; action: string; environment: WorldEnvironment; rp_context: RpContext } {
    return this.createRequestFor(process.env.WORLD_ACTION ?? 'passportkit-verify');
  }

  createSelfieRequest(): { app_id: string; action: string; environment: WorldEnvironment; rp_context: RpContext } {
    const action = this.getSelfieAction();
    const request = this.createRequestFor(action, 'staging');
    this.logger.log(`[Selfie Check] selfie request created; action=${action}; environment=${request.environment}`);
    return request;
  }

  createIdentityRequest(): { app_id: string; action: string; environment: WorldEnvironment; rp_context: RpContext } {
    return this.createRequestFor(process.env.WORLD_IDENTITY_ACTION ?? process.env.WORLD_ACTION ?? 'passportkit-verify');
  }

  private getSelfieAction(): string {
    const action = process.env.WORLD_SELFIE_ACTION?.trim();
    if (!action) throw new BadRequestException('WORLD_SELFIE_ACTION is not configured.');
    return action;
  }

  private createRequestFor(action: string, environment: WorldEnvironment = 'staging'): { app_id: string; action: string; environment: WorldEnvironment; rp_context: RpContext } {
    const appId = process.env.WORLD_APP_ID;
    const rpId = process.env.WORLD_RP_ID;
    const signingKeyHex = process.env.WORLD_RP_SIGNING_KEY;

    if (!appId || appId === 'app_' || !rpId || !signingKeyHex) {
      throw new BadRequestException(
        'World ID is not configured. Set WORLD_APP_ID, WORLD_RP_ID and WORLD_RP_SIGNING_KEY in apps/api/.env.',
      );
    }

    const signed = signRequest({ signingKeyHex, action });
    return {
      app_id: appId,
      action,
      environment,
      rp_context: {
        rp_id: rpId,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
        signature: signed.sig,
      },
    };
  }

  async verifyAndPrepareClaim(
    wallet: Address,
    identity: Address,
    idkitResponse: Record<string, unknown>,
  ) {
    return this.verifyAndPreparePersonhoodClaim(wallet, identity, idkitResponse, process.env.WORLD_ACTION ?? 'passportkit-verify', 'identity-check', CLAIM_TOPICS.PROOF_OF_PERSONHOOD);
  }

  async verifySelfieAndPrepareClaim(
    wallet: Address,
    identity: Address,
    idkitResponse: Record<string, unknown>,
  ) {
    const action = this.getSelfieAction();
    const diagnostics = this.getSelfieProofDiagnostics(idkitResponse);
    this.logger.log(`[Selfie Check] backend endpoint called=/world-id/selfie/verify; action=${diagnostics.action ?? 'missing'}; expectedAction=${action}; environment=${diagnostics.environment}; proof type/version=${diagnostics.protocolVersion}/${diagnostics.identifiers.join(',') || 'missing'}; signalPresent=${diagnostics.signalPresent}; rpIdPresent=${diagnostics.rpIdPresent}; responses=${diagnostics.responseCount}`);
    // TEMP diagnostic (sanitized): top-level keys + nonce presence only, never proof/signal values.
    this.logger.log(`[Selfie Check] payload keys=${Object.keys(idkitResponse).join(',')}; noncePresent=${typeof idkitResponse.nonce === 'string'}`);
    // selfieCheckLegacy returns a World ID 3.0 Face proof. Its response identifier is
    // verifier-owned and must not be guessed locally; World verifies the credential below.
    if (diagnostics.protocolVersion !== '3.0' || diagnostics.responseCount === 0) {
      throw new BadRequestException({
        message: 'Selfie Check expected a World ID 3.0 Face proof.',
        proofType: diagnostics.identifiers,
        protocolVersion: diagnostics.protocolVersion,
      });
    }
    return this.verifyAndPreparePersonhoodClaim(
      wallet,
      identity,
      idkitResponse,
      action,
      'selfie-check-beta',
      CLAIM_TOPICS.PROOF_OF_PERSONHOOD,
    );
  }

  async verifyIdentityAndPrepareClaim(wallet: Address, identity: Address, idkitResponse: Record<string, unknown>) {
    const protocolVersion = typeof idkitResponse.protocol_version === 'string' ? idkitResponse.protocol_version : 'missing';
    if (protocolVersion !== '4.0') {
      throw new BadRequestException({ message: 'Identity Check expected a World ID 4.0 document proof.', protocolVersion });
    }
    return this.verifyAndPreparePersonhoodClaim(
      wallet, identity, idkitResponse,
      process.env.WORLD_IDENTITY_ACTION ?? process.env.WORLD_ACTION ?? 'passportkit-verify',
      'identity-check', CLAIM_TOPICS.KYC_VERIFIED,
    );
  }

  private async verifyAndPreparePersonhoodClaim(
    wallet: Address,
    identity: Address,
    idkitResponse: Record<string, unknown>,
    action: string,
    credential: 'identity-check' | 'selfie-check-beta',
    topic: bigint,
  ) {
    const rpId = process.env.WORLD_RP_ID;
    if (!rpId) throw new BadRequestException('WORLD_RP_ID is not configured');

    let verification: { success?: boolean; nullifier?: string; message?: string };
    try {
      const response = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'passportkit-node' },
        // IDKit generates this payload; do not reshape the proof in the browser or server.
        body: JSON.stringify(idkitResponse),
      });
      verification = (await response.json()) as { success?: boolean; nullifier?: string; message?: string };
      const sanitized = this.sanitizeVerifierResponse(verification as SanitizedVerifierResponse);
      if (credential === 'selfie-check-beta') {
        this.logger.log(`[Selfie Check] World verifier response status=${response.status} body=${JSON.stringify(sanitized)}`);
      }
      if (!response.ok || !verification.success) {
        const failedResult = sanitized.results?.find((result) => !result.success);
        const reason = [
          failedResult?.code ?? sanitized.code,
          failedResult?.detail ?? sanitized.detail ?? sanitized.message,
        ].filter(Boolean).join(': ');
        throw new BadRequestException({
          message: reason || 'World ID rejected this proof',
          verifierStatus: response.status,
          verifierCode: sanitized.code,
          verifierRequestId: sanitized.request_id,
        });
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error('World ID verifier request failed', error instanceof Error ? error.stack : undefined);
      throw new BadGatewayException('Unable to reach the World ID verifier');
    }

    // Only a hash of the World action/nullifier reference enters claim data; no proof or PII is on-chain.
    const dataHash = keccak256(
      toHex(JSON.stringify({ provider: 'world-id', credential, action, nullifier: verification.nullifier ?? 'verified' })),
    ) as Hex;
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 365 * 86400);

    try {
      const claim = await this.signing.signClaim({
        identity,
        topic,
        dataHash,
        expiresAt,
        nonce,
      });
      if (credential === 'selfie-check-beta') {
        // TEMP diagnostic: proves the World verification SUCCEEDED and the response mode is onchain.
        this.logger.log('[Selfie Check] World verification OK; returning mode=onchain (frontend will submit the claim from the wallet)');
      }
      return { mode: 'onchain' as const, verified: true, claim };
    } catch (error) {
      if (!this.demo.enabled) throw error;
      if (topic === CLAIM_TOPICS.KYC_VERIFIED) this.demo.markKycVerified(wallet);
      else this.demo.markPersonhoodVerified(wallet);
      this.logger.warn('World proof verified, but no issuer key/contracts are configured: returning explicit MOCK result');
      return {
        mode: 'mock' as const,
        verified: true,
        message: `${credential === 'selfie-check-beta' ? 'Selfie Check' : topic === CLAIM_TOPICS.KYC_VERIFIED ? 'Identity Check' : 'World ID'} verified. DEMO_MODE records a local status only; no claim was written on-chain.`,
      };
    }
  }

  private getSelfieProofDiagnostics(payload: Record<string, unknown>) {
    const responses = Array.isArray(payload.responses) ? payload.responses : [];
    const identifiers = responses.flatMap((entry) => (
      typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).identifier === 'string'
        ? [(entry as Record<string, unknown>).identifier as string]
        : []
    ));
    const signalPresent = typeof payload.signal === 'string'
      || responses.some((entry) => (
        typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).signal_hash === 'string'
      ));
    return {
      protocolVersion: typeof payload.protocol_version === 'string' ? payload.protocol_version : 'missing',
      action: typeof payload.action === 'string' ? payload.action : undefined,
      identifiers,
      responseCount: responses.length,
      environment: typeof payload.environment === 'string' ? payload.environment : 'missing',
      signalPresent,
      rpIdPresent: Boolean(process.env.WORLD_RP_ID),
    };
  }

  private sanitizeVerifierResponse(response: SanitizedVerifierResponse) {
    return {
      success: response.success === true,
      message: typeof response.message === 'string' ? response.message : undefined,
      code: typeof response.code === 'string' ? response.code : undefined,
      detail: typeof response.detail === 'string' ? response.detail : undefined,
      attribute: typeof response.attribute === 'string' ? response.attribute : undefined,
      request_id: typeof response.request_id === 'string' ? response.request_id : undefined,
      results: response.results?.map((result) => ({
        identifier: result.identifier,
        success: result.success === true,
        code: result.code,
        detail: result.detail,
      })),
    };
  }
}
