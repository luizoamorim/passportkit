'use client';

import { useRef, useState } from 'react';
import { IDKitInviteCodeRequestWidget, selfieCheckLegacy, setDebug, type IDKitDebugReport, type IDKitResult, type RpContext } from '@worldcoin/idkit';
import { motion, useReducedMotion } from 'motion/react';
import { createWalletClient, custom, parseAbi, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { requestSelfieCheck, verifySelfieCheck, type WorldRequest } from '@/modules/passport/world-id.service';

type Status = 'idle' | 'preparing' | 'waiting_for_mobile' | 'verifying' | 'verified' | 'cancelled' | 'error';

const IDENTITY_ABI = parseAbi([
  'function submitClaim(uint256 topic, address issuer, bytes sig, bytes data) returns (bytes32)',
]);

type Props = {
  wallet: string;
  identity: string | null;
  status: 'UNVERIFIED' | 'VERIFIED';
  mode: 'mock' | 'onchain';
  onComplete: (message: string, transactionHash?: string) => Promise<void>;
};

/**
 * Selfie Check Beta is intentionally independent from Identity Check. IDKit's invite-code
 * widget renders the QR hand-off on desktop and a World ID deep link on mobile.
 */
export function SelfieCheckCard({ wallet, identity, status: initialStatus, mode, onComplete }: Props) {
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<Status>(initialStatus === 'VERIFIED' ? 'verified' : 'idle');
  const [request, setRequest] = useState<WorldRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const verifyCallCountRef = useRef(0);

  const start = async () => {
    if (!identity) {
      setStatus('error');
      setMessage('Your identity is still being created. Please try again.');
      return;
    }
    setStatus('preparing');
    setMessage(null);
    try {
      // TEMP diagnostic: enable IDKit debug mode so onError receives a populated debug report.
      if (process.env.NODE_ENV !== 'production') setDebug(true);
      const next = await requestSelfieCheck();
      console.info('[Selfie Check] selfie request created', { action: next.action, environment: next.environment });
      setRequest(next);
      setStatus('waiting_for_mobile');
      setOpen(true);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not prepare Selfie Check.');
    }
  };

  const submitClaim = async (claim: { topic: string; issuer: `0x${string}`; signature: `0x${string}`; data: `0x${string}` }) => {
    if (!window.ethereum) throw new Error('Connect MetaMask to submit your own onchain claim.');
    const client = createWalletClient({ chain: sepolia, transport: custom(window.ethereum) });
    return client.writeContract({
      account: wallet as Address,
      address: identity as Address,
      abi: IDENTITY_ABI,
      functionName: 'submitClaim',
      args: [BigInt(claim.topic), claim.issuer, claim.signature, claim.data],
    });
  };

  const handleVerify = async (result: IDKitResult) => {
    setStatus('verifying');
    const payload = result as unknown as Record<string, unknown>;
    const responses = Array.isArray(payload.responses) ? payload.responses : [];
    const identifiers = responses.flatMap((response) => (
      typeof response === 'object' && response !== null && typeof (response as Record<string, unknown>).identifier === 'string'
        ? [(response as Record<string, unknown>).identifier]
        : []
    ));
    verifyCallCountRef.current += 1;
    console.info('[Selfie Check] World App completed; proof received in handleVerify', {
      invocation: verifyCallCountRef.current,
      resultType: typeof result,
      resultKeys: Object.keys(payload),
      protocolVersion: payload.protocol_version,
      proofType: identifiers,
      responseCount: responses.length,
      actionPresent: typeof payload.action === 'string',
      environment: payload.environment,
    });
    try {
      const verified = await verifySelfieCheck(wallet, identity!, payload);
      if (verified.mode === 'onchain') {
        console.info('[Selfie Check] backend verified; mode=onchain — submitting claim from wallet', {
          injectedProviderPresent: typeof window.ethereum !== 'undefined',
        });
        const hash = await submitClaim(verified.claim);
        setStatus('verified');
        setMessage('Selfie Check verified. Your wallet submitted a PROOF_OF_PERSONHOOD claim.');
        console.info('[Selfie Check] UI state updated', { status: 'verified', mode: 'onchain' });
        await onComplete('Selfie Check claim submitted from your wallet.', hash);
      } else {
        setStatus('verified');
        setMessage('Selfie Check verified.');
        console.info('[Selfie Check] UI state updated', { status: 'verified', mode: 'mock' });
        await onComplete(verified.message);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Selfie Check verification failed.';
      setStatus('error');
      setMessage(detail);
      console.error('[Selfie Check] UI state updated', { status: 'error', detail: detail.replace(/0x[a-fA-F0-9]+/g, '[redacted]') });
      throw error;
    }
  };

  const isBusy = status === 'preparing' || status === 'waiting_for_mobile' || status === 'verifying';
  const label = status === 'preparing' ? 'Preparing Selfie Check…' : status === 'waiting_for_mobile' ? 'Continue in World App…' : status === 'verifying' ? 'Verifying selfie…' : initialStatus === 'VERIFIED' || status === 'verified' ? 'Selfie Check verified' : 'Verify with selfie';
  const claimStatus = initialStatus === 'VERIFIED' || status === 'verified' ? 'VERIFIED' : status === 'error' ? 'FAILED' : isBusy ? 'PROCESSING' : 'UNVERIFIED';

  return (
    <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, ease: 'easeOut' }} whileHover={reduceMotion ? undefined : { y: -2 }} className="h-full rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-lg text-violet-700">◌</div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-600">Beta credential</p><h2 className="mt-1 text-xl font-bold tracking-tight text-[#0D1428]">Selfie Check</h2></div>
        <ClaimStatusBadge status={claimStatus} />
      </div>
      <p className="text-sm leading-6 text-slate-600">A low-assurance liveness and continuity check. Desktop shows a QR code; mobile opens World ID with a secure deep link.</p>
      <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"><span className="font-bold text-slate-700">Privacy note.</span> This is personhood evidence only. It never creates a KYC verification.</p>
      {mode === 'mock' && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800"><span className="font-bold">Demo mode.</span> A successful sandbox proof updates local status only; it does not write onchain.</p>}
      {message && <p role={status === 'error' ? 'alert' : 'status'} className={`mt-5 rounded-xl px-3 py-2.5 text-xs leading-5 ${status === 'error' ? 'border border-red-200 bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>{message}</p>}
      <motion.button whileHover={isBusy || status === 'verified' || reduceMotion ? undefined : { scale: 1.01 }} whileTap={isBusy || status === 'verified' || reduceMotion ? undefined : { scale: 0.99 }} onClick={start} disabled={isBusy || status === 'verified'} className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-700 focus:outline-none focus:ring-4 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">{label}</motion.button>
      {request && <IDKitInviteCodeRequestWidget open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen && status === 'waiting_for_mobile') { setStatus('cancelled'); setMessage('Selfie Check was cancelled before a proof was received.'); } }} app_id={request.app_id} action={request.action} rp_context={request.rp_context as RpContext} environment={request.environment} preset={selfieCheckLegacy({ signal: wallet.toLowerCase() })} allow_legacy_proofs={true} autoClose={false} handleVerify={handleVerify} onSuccess={() => { console.info('[Selfie Check] onSuccess called'); setOpen(false); }} onError={(code, debugReport?: IDKitDebugReport) => { console.error('[Selfie Check] widget error', { errorCode: code, requestId: debugReport?.request_id, debugReport: debugReport ? { version: debugReport.version, packageVersion: debugReport.package_version, transport: debugReport.transport, generatedAt: debugReport.generated_at, requestId: debugReport.request_id, miniApp: debugReport.mini_app } : undefined }); setMessage((current) => current ?? (code === 'user_rejected' ? 'Selfie Check was cancelled.' : 'Selfie Check could not complete verification.')); setStatus(code === 'user_rejected' ? 'cancelled' : 'error'); }} />}
    </motion.div>
  );
}
