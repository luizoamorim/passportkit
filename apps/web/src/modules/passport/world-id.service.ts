import { apiFetch } from '@/lib/api';

export type EligibilityState = {
  wallet: string;
  identity: string | null;
  dealRoom: { eligible: boolean; reason: string };
  investor: { eligible: boolean; reason: string };
  personhood: { status: 'UNVERIFIED' | 'VERIFIED'; mode: 'mock' | 'onchain' };
  kyc: { status: 'UNVERIFIED' | 'VERIFIED'; mode: 'mock' | 'onchain' };
  mode: 'mock' | 'onchain';
};

export type WorldRequest = {
  app_id: `app_${string}`;
  action: string;
  environment: 'staging' | 'sandbox';
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
};

export type PreparedClaim = {
  mode: 'onchain';
  verified: true;
  claim: { topic: string; issuer: `0x${string}`; signature: `0x${string}`; data: `0x${string}` };
};

export async function getEligibility(wallet: string) {
  return apiFetch<EligibilityState>(`/eligibility/${wallet}`);
}

export async function createIdentity(wallet: string) {
  return apiFetch<{ identity: string; created: boolean; transactionHash: string | null }>('/identity/create', {
    method: 'POST', body: JSON.stringify({ wallet }),
  });
}

export async function requestWorldId() {
  return apiFetch<WorldRequest>('/world-id/request', { method: 'POST' });
}

export async function requestSelfieCheck() {
  return apiFetch<WorldRequest>('/world-id/selfie/request', { method: 'POST' });
}

export async function requestIdentityCheck() {
  return apiFetch<WorldRequest>('/world-id/identity/request', { method: 'POST' });
}

export async function verifyWorldId(wallet: string, identity: string, idkitResponse: Record<string, unknown>) {
  return apiFetch<PreparedClaim | { mode: 'mock'; verified: true; message: string }>('/world-id/verify', {
    method: 'POST', body: JSON.stringify({ wallet, identity, idkitResponse }),
  });
}

export async function verifySelfieCheck(wallet: string, identity: string, idkitResponse: Record<string, unknown>) {
  try {
    const result = await apiFetch<PreparedClaim | { mode: 'mock'; verified: true; message: string }>('/world-id/selfie/verify', {
      method: 'POST', body: JSON.stringify({ wallet, identity, idkitResponse }),
    });
    console.info('[Selfie Check] backend response status/body', { status: 200, mode: result.mode, verified: result.verified });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown backend error';
    const status = /^API (\d+):/.exec(message)?.[1] ?? 'network';
    console.error('[Selfie Check] backend response status/body', { status, message: message.replace(/0x[a-fA-F0-9]+/g, '[redacted]') });
    throw error;
  }
}

export async function verifyIdentityCheck(wallet: string, identity: string, idkitResponse: Record<string, unknown>) {
  return apiFetch<PreparedClaim | { mode: 'mock'; verified: true; message: string }>('/world-id/identity/verify', {
    method: 'POST', body: JSON.stringify({ wallet, identity, idkitResponse }),
  });
}
