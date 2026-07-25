import { Injectable, Logger } from '@nestjs/common';
import { signRequest } from '@worldcoin/idkit-server';

/**
 * The two World flows the demo offers. Each maps to a real claim topic in the controller.
 *   selfie   -> Self Check (face / low-friction personhood) -> PROOF_OF_PERSONHOOD
 *   document -> ID Verification (passport / document)        -> KYC_VERIFIED
 */
export type WorldKind = 'selfie' | 'document';

/** RpContext (World ID v4) — mirrors @worldcoin/idkit-core RpContext; the widget requires it. */
export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

/** What the frontend needs to open the IDKit widget for a kind. */
export interface WorldRequestConfig {
  app_id: string;
  action: string;
  rp_context: RpContext;
  mock: boolean; // true => DEMO_MODE placeholder (no real World app / RP key configured)
}

/** A single credential response inside an IDKitResult (V3 | V4 | Session — we read only the safe bits). */
interface WorldResponseItem {
  identifier?: string;
  nullifier?: string;
  session_nullifier?: string[];
  issuer_schema_id?: number;
}

/** The IDKitResult the widget hands back. A cryptographic proof — NEVER PII. */
export interface WorldResult {
  responses?: WorldResponseItem[];
}

export interface WorldVerifyResult {
  ok: boolean;
  nullifierHash: string; // the sanitized reference we anchor the claim to
  credential: string; // which World credential proved it (e.g. "selfie", "passport")
  mock: boolean; // true when accepted via the DEMO_MODE fallback
}

/** Credentials we accept per flow (v4 identifiers). Lenient: any match is enough. */
const EXPECTED_CREDENTIALS: Record<WorldKind, string[]> = {
  selfie: ['selfie', 'proof_of_human'],
  document: ['passport', 'mnc', 'eid', 'secure_document', 'document'],
};

/**
 * WorldService — the demo's ONE real verification, World ID **v4** (RP-signature model).
 *
 * v4 is a two-step handshake:
 *   1) buildRequest(kind): the RP (this backend) signs the request with its registered signing key
 *      (signRequest) so World App trusts the request came from us -> returns { app_id, action, rp_context }.
 *   2) verifyResult(kind, result): the widget returns an IDKitResult with Groth16 proofs; we validate it
 *      structurally + extract ONLY the nullifier (a per-user pseudonym, never PII). Full on-chain proof
 *      verification via WorldIDVerifier.sol is the documented production step.
 *
 * Graceful-degrade (mirrors revocation.service): if the World app / RP key are unset, DEMO_MODE lets the
 * flow run with a labeled mock so the demo works before the Developer Portal keys are wired.
 */
@Injectable()
export class WorldService {
  private readonly logger = new Logger(WorldService.name);
  private readonly appId: string;
  private readonly rpId: string;
  private readonly signingKeyHex: string;
  private readonly actionPersonhood: string;
  private readonly actionKyc: string;

  constructor() {
    this.appId = process.env.WORLD_APP_ID ?? '';
    this.rpId = process.env.WORLD_RP_ID ?? '';
    this.signingKeyHex = process.env.WORLD_RP_SIGNING_KEY ?? '';
    const fallback = process.env.WORLD_ACTION ?? '';
    this.actionPersonhood = process.env.WORLD_ACTION_PERSONHOOD || fallback;
    this.actionKyc = process.env.WORLD_ACTION_KYC || fallback;
    if (this.isConfigured) {
      this.logger.log(`World v4 ready: app=${this.appId} rp=${this.rpId}`);
    } else {
      this.logger.warn('World v4 not fully configured — /world uses DEMO_MODE fallback until keys are set');
    }
  }

  /** All three are needed to sign a real RP request. */
  private get isConfigured(): boolean {
    return this.appId.startsWith('app_') && !!this.rpId && !!this.signingKeyHex;
  }

  private actionFor(kind: WorldKind): string {
    return kind === 'selfie' ? this.actionPersonhood : this.actionKyc;
  }

  /** Step 1: RP-sign a proof request the frontend widget can open. */
  buildRequest(kind: WorldKind): WorldRequestConfig {
    const action = this.actionFor(kind);

    if (!this.isConfigured) {
      if (process.env.DEMO_MODE !== 'true') {
        throw new Error('World app / RP signing key not configured');
      }
      this.logger.warn(`World buildRequest MOCK (DEMO_MODE) kind=${kind}`);
      return {
        app_id: this.appId || 'app_demo',
        action: action || `passportkit-${kind}`,
        rp_context: { rp_id: 'rp_demo', nonce: '0x0', created_at: 0, expires_at: 0, signature: '0x0' },
        mock: true,
      };
    }

    if (!action) throw new Error(`no World action configured for kind=${kind}`);

    const sig = signRequest({ signingKeyHex: this.signingKeyHex, action });
    this.logger.log(`World buildRequest kind=${kind} action=${action}`);
    return {
      app_id: this.appId,
      action,
      rp_context: {
        rp_id: this.rpId,
        nonce: sig.nonce,
        created_at: sig.createdAt,
        expires_at: sig.expiresAt,
        signature: sig.sig,
      },
      mock: false,
    };
  }

  /** Step 2: validate the widget result + extract the sanitized nullifier. */
  verifyResult(kind: WorldKind, result: WorldResult): WorldVerifyResult {
    const responses = result?.responses ?? [];

    if (!this.isConfigured) {
      if (process.env.DEMO_MODE !== 'true') {
        throw new Error('World app / RP signing key not configured');
      }
      const nullifier = this.extractNullifier(responses) ?? `0xdemo-${kind}`;
      this.logger.warn(`World verifyResult MOCK (DEMO_MODE) kind=${kind}`);
      return { ok: true, nullifierHash: nullifier, credential: 'demo', mock: true };
    }

    if (responses.length === 0) throw new Error('World result has no credential responses');

    const expected = EXPECTED_CREDENTIALS[kind];
    const match = responses.find((r) => r.identifier && expected.includes(r.identifier));
    const chosen = match ?? responses[0];
    if (!match) {
      this.logger.warn(
        `World verifyResult kind=${kind}: no expected credential (${expected.join('|')}); ` +
          `got ${responses.map((r) => r.identifier).join(',')}`,
      );
    }

    const nullifier = this.extractNullifier([chosen]);
    if (!nullifier) throw new Error('World result missing nullifier');

    // NOTE: full cryptographic proof verification is done on-chain by WorldIDVerifier.sol
    // (the v4 proofs are Groth16 arrays compatible with it). That is the production step.
    this.logger.log(`World verifyResult ok kind=${kind} credential=${chosen.identifier}`);
    return { ok: true, nullifierHash: nullifier, credential: chosen.identifier ?? 'unknown', mock: false };
  }

  /** nullifier lives in `.nullifier` (V3/V4) or `.session_nullifier[0]` (session). */
  private extractNullifier(responses: WorldResponseItem[]): string | undefined {
    for (const r of responses) {
      if (r.nullifier) return r.nullifier;
      if (r.session_nullifier && r.session_nullifier.length > 0) return r.session_nullifier[0];
    }
    return undefined;
  }
}
