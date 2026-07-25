import { Injectable, Logger } from '@nestjs/common';

/**
 * The two World flows the demo offers. Each maps to a real claim topic in the controller.
 *   selfie   -> Self Check (low-friction personhood) -> PROOF_OF_PERSONHOOD
 *   document -> ID Verification (document / NFC)      -> KYC_VERIFIED
 */
export type WorldKind = 'selfie' | 'document';

/** The IDKit ISuccessResult the widget hands back — a cryptographic proof, NEVER PII. */
export interface WorldProof {
  merkle_root: string;
  nullifier_hash: string;
  proof: string;
  verification_level?: string;
}

export interface WorldVerifyResult {
  ok: boolean;
  nullifierHash: string; // the sanitized reference we anchor the claim to
  mock: boolean; // true when validated via the DEMO_MODE fallback (no real World app configured)
}

const WORLD_VERIFY_BASE = 'https://developer.worldcoin.org/api/v2/verify';

/**
 * WorldService — validates a World ID proof, the demo's ONE real verification.
 *
 * It calls World's cloud verify endpoint with the app id + the action for the given kind. On success
 * it returns ONLY the nullifier hash (a per-user-per-action pseudonym) — never PII. Mirrors
 * revocation.service's graceful-degrade: if WORLD_APP_ID is unset, DEMO_MODE lets the proof pass as a
 * labeled mock so the flow works before booth keys arrive; outside DEMO_MODE an unconfigured app fails.
 */
@Injectable()
export class WorldService {
  private readonly logger = new Logger(WorldService.name);
  private readonly appId: string;
  private readonly actionPersonhood: string;
  private readonly actionKyc: string;

  constructor() {
    this.appId = process.env.WORLD_APP_ID ?? '';
    const fallback = process.env.WORLD_ACTION ?? '';
    this.actionPersonhood = process.env.WORLD_ACTION_PERSONHOOD || fallback;
    this.actionKyc = process.env.WORLD_ACTION_KYC || fallback;
    if (this.isConfigured) {
      this.logger.log(`World verify ready: app=${this.appId}`);
    } else {
      this.logger.warn('WORLD_APP_ID not set — World verify uses DEMO_MODE fallback until configured');
    }
  }

  private get isConfigured(): boolean {
    return this.appId.startsWith('app_');
  }

  private actionFor(kind: WorldKind): string {
    return kind === 'selfie' ? this.actionPersonhood : this.actionKyc;
  }

  async verify(kind: WorldKind, proof: WorldProof): Promise<WorldVerifyResult> {
    // Fallback: no real World app -> only allowed in DEMO_MODE, and clearly labeled mock.
    if (!this.isConfigured) {
      if (process.env.DEMO_MODE !== 'true') {
        throw new Error('WORLD_APP_ID not configured');
      }
      this.logger.warn(`World verify MOCK (DEMO_MODE) kind=${kind}`);
      return { ok: true, nullifierHash: proof.nullifier_hash, mock: true };
    }

    const action = this.actionFor(kind);
    if (!action) throw new Error(`no World action configured for kind=${kind}`);

    const res = await fetch(`${WORLD_VERIFY_BASE}/${this.appId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        nullifier_hash: proof.nullifier_hash,
        merkle_root: proof.merkle_root,
        proof: proof.proof,
        verification_level: proof.verification_level,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      this.logger.warn(`World verify rejected kind=${kind} status=${res.status} ${detail}`);
      throw new Error(`World verification failed (${res.status})`);
    }

    this.logger.log(`World verify ok kind=${kind} action=${action}`);
    return { ok: true, nullifierHash: proof.nullifier_hash, mock: false };
  }
}
