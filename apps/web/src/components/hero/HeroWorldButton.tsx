'use client';

import { useState } from 'react';
import { IDKitRequestWidget, selfieCheckLegacy, identityCheck } from '@worldcoin/idkit';
import type { Address } from 'viem';
import { requestWorldProof, verifyWorldProof, type WorldKind, type WorldRequestConfig } from '@/lib/world-api';
import { submitClaim } from '@/lib/world-chain';

const WORLD_ENV = (process.env.NEXT_PUBLIC_WORLD_ENV ?? 'production') as
  | 'production'
  | 'staging'
  | 'sandbox';

type Phase = 'idle' | 'requesting' | 'widget' | 'verifying' | 'submitting' | 'done' | 'error';

function mockResult(kind: WorldKind) {
  return { responses: [{ identifier: kind === 'selfie' ? 'face' : 'passport', nullifier: `0xdemo-${kind}` }] };
}

/**
 * One World ID flow as a button: request (RP-sign) -> widget -> verify -> the user submits the signed
 * claim to their own Identity (Model B). Single-kind sibling of WorldVerifyCard, for the guided hero flow.
 */
export function HeroWorldButton({
  kind,
  wallet,
  identity,
  disabled,
  label,
  onDone,
}: {
  kind: WorldKind;
  wallet: Address;
  identity: Address;
  disabled?: boolean;
  label: string;
  onDone: (txHash: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [config, setConfig] = useState<WorldRequestConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function complete(result: unknown) {
    try {
      setPhase('verifying');
      const claim = await verifyWorldProof(identity, kind, result);
      setPhase('submitting');
      const txHash = await submitClaim({
        wallet,
        identity,
        topic: BigInt(claim.topic),
        issuer: claim.issuer,
        signature: claim.signature,
        data: claim.data,
      });
      setPhase('done');
      onDone(txHash);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
      setPhase('error');
    }
  }

  async function start() {
    try {
      setError(null);
      setPhase('requesting');
      const cfg = await requestWorldProof(kind);
      if (cfg.mock) {
        await complete(mockResult(kind));
        return;
      }
      setConfig(cfg);
      setPhase('widget');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start World ID');
      setPhase('error');
    }
  }

  const busy = ['requesting', 'widget', 'verifying', 'submitting'].includes(phase);
  const text =
    phase === 'done'
      ? '✓ Verified'
      : phase === 'requesting'
        ? 'Starting…'
        : phase === 'widget'
          ? 'Scan with World App…'
          : phase === 'verifying'
            ? 'Verifying proof…'
            : phase === 'submitting'
              ? 'Submitting claim…'
              : label;

  return (
    <div>
      <button
        onClick={start}
        disabled={disabled || busy || phase === 'done'}
        className="text-sm font-semibold px-4 py-2.5 rounded-lg bg-[#0D1428] text-white hover:bg-[#1c2a4a] transition-colors disabled:opacity-40 w-full"
      >
        {text}
      </button>
      {error && <p className="text-[11px] text-red-600 mt-2 break-words">{error}</p>}
      {phase === 'widget' && config && (
        <IDKitRequestWidget
          open
          onOpenChange={(open) => {
            if (!open && phase === 'widget') setPhase('idle');
          }}
          app_id={config.app_id as `app_${string}`}
          action={config.action}
          rp_context={config.rp_context}
          environment={WORLD_ENV}
          allow_legacy_proofs
          preset={
            kind === 'selfie'
              ? selfieCheckLegacy()
              : identityCheck({ attributes: [{ type: 'minimum_age', value: 18 }] })
          }
          onSuccess={(result) => complete(result)}
          onError={() => {
            setError('World App rejected or cancelled the request');
            setPhase('error');
          }}
        />
      )}
    </div>
  );
}
