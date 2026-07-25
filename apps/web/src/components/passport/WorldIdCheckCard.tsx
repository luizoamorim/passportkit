'use client';

import { useState } from 'react';
import {
  IDKitRequestWidget,
  identityCheck,
  proofOfHuman,
  selfieCheckLegacy,
  type IDKitErrorCodes,
  type IDKitResult,
  type Preset,
  type RpContext,
} from '@worldcoin/idkit';
import { parseAbi, type Address } from 'viem';
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { activeChain } from '@/lib/wagmi';
import {
  requestWorldId,
  verifyWorldId,
  type WorldCheck,
  type WorldRequest,
} from '@/modules/passport/world-id.service';

type Status = 'idle' | 'preparing' | 'verifying' | 'verified' | 'error';

const IDENTITY_ABI = parseAbi([
  'function submitClaim(uint256 topic, address issuer, bytes sig, bytes data) returns (bytes32)',
]);

const CHECK_COPY: Record<WorldCheck, { eyebrow: string; title: string; description: string; cta: string }> = {
  personhood: {
    eyebrow: 'Personhood',
    title: 'Proof of Human',
    description: 'Prove you are a unique person with World ID. Only a hashed proof reference enters the PassportKit claim.',
    cta: 'Verify with World ID',
  },
  selfie: {
    eyebrow: 'Selfie Check · Beta',
    title: 'Selfie liveness',
    description: 'A quick selfie in World ID proves liveness and facial continuity — no Orb required. Valid for 90 days.',
    cta: 'Start Selfie Check',
  },
  identity: {
    eyebrow: 'Identity Check · Preview',
    title: 'Document attributes',
    description: 'Attest that your document matches the policy (passport, 18+) without sharing the document itself.',
    cta: 'Start Identity Check',
  },
};

/** IDKit error codes worth a specific sentence; everything else gets the generic line. */
function errorMessage(check: WorldCheck, code: IDKitErrorCodes): string {
  switch (code) {
    case 'user_rejected':
    case 'verification_rejected':
      return 'World ID verification was cancelled.';
    case 'credential_unavailable':
      return check === 'selfie'
        ? 'Your World ID has no Selfie Check credential yet — open World ID and enroll first.'
        : 'Your World ID does not hold the credential this check needs.';
    case 'identity_attributes_not_matched':
      return 'Your document attributes did not match the policy (passport, 18+).';
    case 'user_presence_failed':
      return 'The liveness check did not complete. Please try again.';
    case 'invalid_network':
      return 'Environment mismatch between this site and your World App (production vs staging/sandbox). Ask the operator to align WORLD_ENV with the device.';
    case 'inclusion_proof_pending':
      return 'Your credential is still being registered by World. Try again in a few minutes.';
    case 'max_verifications_reached':
      return 'This World ID already verified this action the maximum number of times.';
    default:
      return 'World ID could not complete verification.';
  }
}

function presetFor(check: WorldCheck, wallet: string, request: WorldRequest): Preset {
  if (check === 'selfie') return selfieCheckLegacy({ signal: wallet.toLowerCase() });
  if (check === 'identity') return identityCheck({ attributes: request.identity_attributes ?? [] });
  return proofOfHuman({ signal: wallet.toLowerCase() });
}

type Props = {
  check: WorldCheck;
  wallet: string;
  identity: string | null;
  status: 'UNVERIFIED' | 'VERIFIED';
  mode: 'mock' | 'onchain';
  onComplete: (message: string, transactionHash?: string) => Promise<void>;
};

export function WorldIdCheckCard({ check, wallet, identity, status: initialStatus, mode, onComplete }: Props) {
  const [status, setStatus] = useState<Status>(initialStatus === 'VERIFIED' ? 'verified' : 'idle');
  const [request, setRequest] = useState<WorldRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const copy = CHECK_COPY[check];

  const start = async () => {
    if (!identity) { setStatus('error'); setMessage('Your identity is still being created. Please try again.'); return; }
    setStatus('preparing'); setMessage(null);
    try {
      const next = await requestWorldId(check);
      // Back to idle once the sheet is open: otherwise closing it leaves the
      // button disabled on "Preparing…" with no way to retry.
      setRequest(next); setOpen(true); setStatus('idle');
    } catch (error) {
      setStatus('error'); setMessage(error instanceof Error ? error.message : 'Could not prepare World ID.');
    }
  };

  // Signs through whichever wallet is connected — injected, WalletConnect or Coinbase.
  const submitClaim = async (claim: { topic: string; issuer: `0x${string}`; signature: `0x${string}`; data: `0x${string}` }) => {
    if (!walletClient) throw new Error('Connect a wallet to submit your own onchain claim.');
    if (chainId !== activeChain.id) {
      await switchChainAsync({ chainId: activeChain.id });
    }
    return walletClient.writeContract({
      account: wallet as Address,
      chain: activeChain,
      address: identity as Address,
      abi: IDENTITY_ABI,
      functionName: 'submitClaim',
      args: [BigInt(claim.topic), claim.issuer, claim.signature, claim.data],
    });
  };

  const handleVerify = async (result: IDKitResult) => {
    setStatus('verifying'); setMessage(null);
    try {
      const verified = await verifyWorldId(wallet, identity!, check, result as unknown as Record<string, unknown>);
      if (verified.mode === 'onchain') {
        const hash = await submitClaim(verified.claim);
        setStatus('verified'); setMessage(`World ID verified. Your wallet submitted the ${copy.title} claim.`);
        await onComplete('Claim submitted from your wallet.', hash);
      } else {
        setStatus('verified'); setMessage(verified.message);
        await onComplete(verified.message);
      }
    } catch (error) {
      // A rejected signature or a failing backend must not leave the card stuck on "Verifying".
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not complete verification.');
      throw error; // Tell the widget too, so it shows its error state instead of success.
    }
  };

  const label =
    status === 'preparing' ? 'Preparing World ID…'
    : status === 'verifying' ? 'Verifying proof…'
    : initialStatus === 'VERIFIED' || status === 'verified' ? 'Verified'
    : copy.cta;

  return (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF]">{copy.eyebrow}</p>
          <h2 className="font-bold text-[#0D1428]">{copy.title}</h2>
        </div>
        <ClaimStatusBadge status={(initialStatus === 'VERIFIED' || status === 'verified') ? 'VERIFIED' : status === 'error' ? 'FAILED' : status === 'verifying' ? 'PROCESSING' : 'UNVERIFIED'} />
      </div>
      <p className="text-sm text-[#4B5568] mb-4">{copy.description}</p>
      {mode === 'mock' && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">MOCK mode: a verified proof updates local demo state only; it does not write onchain.</p>}
      {request && request.environment !== 'production' && (
        <p className="text-xs text-[#4B5568] bg-[#F8F9FC] border border-[#DDE1EA] rounded-lg p-2 mb-3">
          {request.environment === 'staging'
            ? 'Staging request — scan it with the World ID Simulator, not a phone.'
            : 'Sandbox request — scan it with the sandbox World ID app.'}
        </p>
      )}
      {message && <p role={status === 'error' ? 'alert' : 'status'} className={`text-xs mb-3 ${status === 'error' ? 'text-red-600' : 'text-[#4B5568]'}`}>{message}</p>}
      <button onClick={start} disabled={status === 'preparing' || status === 'verifying' || status === 'verified' || initialStatus === 'VERIFIED'} className="w-full bg-[#0D1428] text-white text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-50">
        {label}
      </button>
      {request && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={request.app_id}
          action={request.action}
          rp_context={request.rp_context as RpContext}
          environment={request.environment}
          preset={presetFor(check, wallet, request)}
          allow_legacy_proofs={check !== 'identity'}
          handleVerify={handleVerify}
          onSuccess={() => setOpen(false)}
          onError={(code, debugReport) => {
            // Keep transport/payload diagnostics reachable without logging any secret material.
            if (debugReport) console.warn(`[world-id:${check}] debug report`, debugReport);
            // handleVerify already set a specific backend/wallet message — don't overwrite it.
            if (code === 'failed_by_host_app') return;
            setStatus('error');
            setMessage(errorMessage(check, code));
          }}
        />
      )}
    </div>
  );
}
