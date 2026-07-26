'use client';

import { useState } from 'react';
import { IDKitRequestWidget, identityCheck, type IDKitResult, type RpContext } from '@worldcoin/idkit';
import { motion, useReducedMotion } from 'motion/react';
import { createWalletClient, custom, parseAbi, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { requestIdentityCheck, verifyIdentityCheck, type WorldRequest } from '@/modules/passport/world-id.service';

type Status = 'idle' | 'preparing' | 'verifying' | 'verified' | 'error';

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

export function WorldIdPersonhoodCard({ wallet, identity, status: initialStatus, mode, onComplete }: Props) {
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<Status>(initialStatus === 'VERIFIED' ? 'verified' : 'idle');
  const [request, setRequest] = useState<WorldRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const start = async () => {
    if (!identity) { setStatus('error'); setMessage('Your identity is still being created. Please try again.'); return; }
    setStatus('preparing'); setMessage(null);
    try {
      const next = await requestIdentityCheck();
      setRequest(next); setOpen(true);
    } catch (error) {
      setStatus('error'); setMessage(error instanceof Error ? error.message : 'Could not prepare World ID.');
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
    let verified: Awaited<ReturnType<typeof verifyIdentityCheck>>;
    try {
      verified = await verifyIdentityCheck(wallet, identity!, result as unknown as Record<string, unknown>);
    } catch (error) {
      // Only a rejected PROOF may reject handleVerify: IDKit turns that into its
      // "Verification declined" screen. Surface the reason instead of swallowing it.
      const detail = error instanceof Error ? error.message : 'Identity Check verification failed.';
      setStatus('error'); setMessage(detail);
      throw error;
    }

    // The proof is verified from here on: a failed wallet step is not a proof failure.
    if (verified.mode !== 'onchain') {
      setStatus('verified'); setMessage(verified.message);
      await onComplete(verified.message);
      return;
    }
    try {
      const hash = await submitClaim(verified.claim);
      setStatus('verified'); setMessage('Identity Check verified. Your wallet submitted the KYC_VERIFIED claim.');
      await onComplete('Identity Check claim submitted from your wallet.', hash);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The claim could not be submitted.';
      setStatus('error');
      setMessage(`Identity Check verified, but the on-chain claim was not submitted: ${detail}`);
    }
  };

  const label = status === 'preparing' ? 'Preparing Identity Check…' : status === 'verifying' ? 'Verifying identity…' : initialStatus === 'VERIFIED' || status === 'verified' ? 'Identity Check verified' : 'Verify identity';

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: 'easeOut' }}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      className="h-full rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7"
    >
      <div className="flex items-start justify-between gap-3 mb-5">
        <div><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-lg text-blue-700">◉</div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">Beta credential</p><h2 className="mt-1 text-xl font-bold tracking-tight text-[#0D1428]">Identity Check</h2></div>
        <ClaimStatusBadge status={(initialStatus === 'VERIFIED' || status === 'verified') ? 'VERIFIED' : status === 'error' ? 'FAILED' : status === 'verifying' ? 'PROCESSING' : 'UNVERIFIED'} />
      </div>
      <p className="text-sm leading-6 text-slate-600">Verify document-backed identity attributes and eligibility. Only a hashed verification reference is included in your PassportKit claim.</p>
      <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"><span className="font-bold text-slate-700">Document may be required.</span> A successful verification maps only to KYC_VERIFIED.</p>
      {mode === 'mock' && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800"><span className="font-bold">Demo mode.</span> A verified proof updates local status only; it does not write onchain.</p>}
      {message && <p role={status === 'error' ? 'alert' : 'status'} className={`mt-5 rounded-xl px-3 py-2.5 text-xs leading-5 ${status === 'error' ? 'border border-red-200 bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>{message}</p>}
      <motion.button whileHover={status === 'preparing' || status === 'verifying' || status === 'verified' || reduceMotion ? undefined : { scale: 1.01 }} whileTap={status === 'preparing' || status === 'verifying' || status === 'verified' || reduceMotion ? undefined : { scale: 0.99 }} onClick={start} disabled={status === 'preparing' || status === 'verifying' || status === 'verified'} className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
        {label}
      </motion.button>
      {request && <IDKitRequestWidget open={open} onOpenChange={setOpen} app_id={request.app_id} action={request.action} rp_context={request.rp_context as RpContext} environment="staging" preset={identityCheck({ attributes: [{ type: 'document_type', value: 'passport' }, { type: 'minimum_age', value: 18 }] })} allow_legacy_proofs={false} handleVerify={handleVerify} onSuccess={() => setOpen(false)} onError={(code) => { setStatus('error'); setMessage(code === 'user_rejected' ? 'Identity Check was cancelled.' : `Identity Check could not complete verification (${code}).`); }} />}
    </motion.div>
  );
}
