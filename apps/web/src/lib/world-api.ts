import { apiFetch } from './api';
import type { Address, Hex } from 'viem';

/** The two World flows the demo offers. */
export type WorldKind = 'selfie' | 'document';

/** v4 RpContext returned by the backend (RP-signed) — the widget requires it. */
export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

export interface WorldRequestConfig {
  app_id: string;
  action: string;
  rp_context: RpContext;
  mock: boolean;
}

/** The signed claim the user submits to their own Identity (Model B). */
export interface WorldSignedClaim {
  world: true;
  mock: boolean;
  kind: WorldKind;
  credential: string;
  topicName: string;
  topic: string; // uint256 as decimal string
  issuer: Address;
  signature: Hex;
  data: Hex;
}

/** Step 1: ask the backend to RP-sign a proof request for this flow. */
export function requestWorldProof(kind: WorldKind): Promise<WorldRequestConfig> {
  return apiFetch<WorldRequestConfig>('/world/request', {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });
}

/** Step 2: send the widget result to the backend, which validates it and signs the claim.
 *  `topicName` (DEMO_MODE only) maps the real proof to a chosen topic — e.g. Selfie Check -> KYC. */
export function verifyWorldProof(
  identity: Address,
  kind: WorldKind,
  result: unknown,
  topicName?: string,
): Promise<WorldSignedClaim> {
  return apiFetch<WorldSignedClaim>('/world/verify', {
    method: 'POST',
    body: JSON.stringify({ identity, kind, result, topicName }),
  });
}
