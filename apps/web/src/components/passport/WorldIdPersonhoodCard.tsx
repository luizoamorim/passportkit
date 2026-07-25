'use client';

import { useState } from 'react';
import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from '@worldcoin/idkit';
import { parseAbi, type Address } from 'viem';
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { activeChain } from '@/lib/wagmi';
import { requestWorldId, verifyWorldId, type WorldRequest } from '@/modules/passport/world-id.service';

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
  const [status, setStatus] = useState<Status>(initialStatus === 'VERIFIED' ? 'verified' : 'idle');
  const [request, setRequest] = useState<WorldRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  const start = async () => {
    if (!identity) { setStatus('error'); setMessage('Your identity is still being created. Please try again.'); return; }
    setStatus('preparing'); setMessage(null);
    try {
      const next = await requestWorldId();
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
      const verified = await verifyWorldId(wallet, identity!, result as unknown as Record<string, unknown>);
      if (verified.mode === 'onchain') {
        const hash = await submitClaim(verified.claim);
        setStatus('verified'); setMessage('World ID verified. Your wallet submitted the PROOF_OF_PERSONHOOD claim.');
        await onComplete('Claim submitted from your wallet.', hash);
      } else {
        setStatus('verified'); setMessage(verified.message);
        await onComplete(verified.message);
      }
    } catch (error) {
      // A rejected signature or a failing backend must not leave the card stuck on "Verifying".
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not complete verification.');
    }
  };

  const label = status === 'preparing' ? 'Preparing World ID…' : status === 'verifying' ? 'Verifying proof…' : initialStatus === 'VERIFIED' || status === 'verified' ? 'Personhood verified' : 'Verify with World ID';

  return (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div><p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF]">Personhood</p><h2 className="font-bold text-[#0D1428]">World ID</h2></div>
        <ClaimStatusBadge status={(initialStatus === 'VERIFIED' || status === 'verified') ? 'VERIFIED' : status === 'error' ? 'FAILED' : status === 'verifying' ? 'PROCESSING' : 'UNVERIFIED'} />
      </div>
      <p className="text-sm text-[#4B5568] mb-4">Prove you are a unique person with World ID. Only a hashed proof reference is included in the PassportKit claim.</p>
      {mode === 'mock' && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">MOCK mode: a verified proof updates local demo state only; it does not write onchain.</p>}
      {message && <p role={status === 'error' ? 'alert' : 'status'} className={`text-xs mb-3 ${status === 'error' ? 'text-red-600' : 'text-[#4B5568]'}`}>{message}</p>}
      <button onClick={start} disabled={status === 'preparing' || status === 'verifying' || status === 'verified'} className="w-full bg-[#0D1428] text-white text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-50">
        {label}
      </button>
      {request && <IDKitRequestWidget open={open} onOpenChange={setOpen} app_id={request.app_id} action={request.action} rp_context={request.rp_context as RpContext} environment="staging" preset={proofOfHuman({ signal: wallet.toLowerCase() })} allow_legacy_proofs={true} handleVerify={handleVerify} onSuccess={() => setOpen(false)} onError={(code) => { setStatus('error'); setMessage(code === 'user_rejected' ? 'World ID verification was cancelled.' : 'World ID could not complete verification.'); }} />}
    </div>
  );
}
