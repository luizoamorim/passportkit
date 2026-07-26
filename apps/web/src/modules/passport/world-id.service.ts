import { apiFetch } from '@/lib/api';

export type WorldCheck = 'personhood' | 'selfie' | 'identity';
export type WorldEnvironment = 'production' | 'staging' | 'sandbox';
export type CheckStatus = 'UNVERIFIED' | 'VERIFIED';

export type IdentityAttribute =
  | { type: 'document_type'; value: 'passport' | 'eid' | 'mnc' }
  | { type: 'document_number'; value: string }
  | { type: 'issuing_country'; value: string }
  | { type: 'full_name'; value: string }
  | { type: 'minimum_age'; value: number }
  | { type: 'nationality'; value: string };

export type EligibilityState = {
  wallet: string;
  identity: string | null;
  dealRoom: { eligible: boolean; reason: string };
  investor: { eligible: boolean; reason: string };
  personhood: { status: CheckStatus; mode: 'mock' | 'onchain' };
  checks: Record<WorldCheck, CheckStatus>;
  mode: 'mock' | 'onchain';
};

export type WorldRequest = {
  check: WorldCheck;
  app_id: `app_${string}`;
  action: string;
  environment: WorldEnvironment;
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
  identity_attributes?: IdentityAttribute[];
};

export type PreparedClaim = {
  mode: 'onchain';
  verified: true;
  check: WorldCheck;
  claim: { topic: string; issuer: `0x${string}`; signature: `0x${string}`; data: `0x${string}` };
};

export type MockVerification = { mode: 'mock'; verified: true; check: WorldCheck; message: string };

export async function getEligibility(wallet: string) {
  return apiFetch<EligibilityState>(`/eligibility/${wallet}`);
}

export async function createIdentity(wallet: string) {
  return apiFetch<{ identity: string; created: boolean; transactionHash: string | null }>('/identity/create', {
    method: 'POST', body: JSON.stringify({ wallet }),
  });
}

export async function requestWorldId(check: WorldCheck) {
  return apiFetch<WorldRequest>('/world-id/request', { method: 'POST', body: JSON.stringify({ check }) });
}

export async function verifyWorldId(
  wallet: string,
  identity: string,
  check: WorldCheck,
  idkitResponse: Record<string, unknown>,
) {
  return apiFetch<PreparedClaim | MockVerification>('/world-id/verify', {
    method: 'POST', body: JSON.stringify({ wallet, identity, check, idkitResponse }),
  });
}
