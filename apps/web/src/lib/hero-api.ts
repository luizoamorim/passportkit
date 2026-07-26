import { apiFetch } from './api';
import type { Address, Hex } from 'viem';

/** POST /hero/provision — create identity + gas drip + bind <label>.casaazul.eth (live ENS). */
export interface ProvisionResult {
  identity: Address;
  wallet: Address;
  ensName: string;
  created: boolean;
  txs: Record<string, Hex | null>;
}

/** POST /hero/link-agent — linkAgent (Model A) + bind bot.<label> + setScore + gas drip + mint. */
export interface LinkAgentResult {
  agentWallet: Address;
  personIdentity: Address;
  agentEnsName: string;
  score: number;
  txs: Record<string, Hex | null>;
}

export function provisionUser(wallet: Address, label: string): Promise<ProvisionResult> {
  return apiFetch<ProvisionResult>('/hero/provision', {
    method: 'POST',
    body: JSON.stringify({ wallet, label }),
  });
}

export function linkAgent(
  agentWallet: Address,
  personIdentity: Address,
  label: string,
  score?: number,
): Promise<LinkAgentResult> {
  return apiFetch<LinkAgentResult>('/hero/link-agent', {
    method: 'POST',
    body: JSON.stringify({ agentWallet, personIdentity, label, score }),
  });
}

/** POST /issuer/mock-claim — the labeled ACCREDITED mock (DEMO_MODE). Returns a signed claim to submit. */
export interface SignedClaim {
  topic: string;
  issuer: Address;
  signature: Hex;
  data: Hex;
}

export function mockAccreditedClaim(identity: Address): Promise<SignedClaim & { mock: boolean }> {
  return apiFetch('/issuer/mock-claim', {
    method: 'POST',
    body: JSON.stringify({ identity, topic: 'ACCREDITED_INVESTOR' }),
  });
}

/** POST /issuer/revoke — the money moment (agent key latches the person's KYC). */
export function revokeClaim(identity: Address, topic = 'KYC_VERIFIED', value = true): Promise<unknown> {
  return apiFetch('/issuer/revoke', {
    method: 'POST',
    body: JSON.stringify({ identity, topic, value }),
  });
}
