'use client';

import { useState } from 'react';
import { IDKitRequestWidget, selfieCheckLegacy, passport } from '@worldcoin/idkit';
import type { Address } from 'viem';
import {
  requestWorldProof,
  verifyWorldProof,
  type WorldKind,
  type WorldRequestConfig,
} from '@/lib/world-api';
import { submitClaim } from '@/lib/world-chain';

type Phase = 'idle' | 'requesting' | 'widget' | 'verifying' | 'submitting' | 'done' | 'error';

interface FlowState {
  phase: Phase;
  config?: WorldRequestConfig;
  txHash?: string;
  error?: string;
}

const FLOWS: { kind: WorldKind; title: string; sub: string; emoji: string; topic: string }[] = [
  { kind: 'selfie', title: 'Self Check', sub: 'Face verification (low friction)', emoji: '🙂', topic: 'Proof of Personhood' },
  { kind: 'document', title: 'ID Verification', sub: 'Passport / document', emoji: '🪪', topic: 'KYC Verified' },
];

/** DEMO_MODE mock result so the flow runs end-to-end before World keys are wired. */
function mockResult(kind: WorldKind) {
  return {
    responses: [
      {
        identifier: kind === 'selfie' ? 'selfie' : 'passport',
        nullifier: `0xdemo-${kind}`,
      },
    ],
  };
}

export function WorldVerifyCard({
  wallet,
  identity,
  onVerified,
}: {
  wallet: Address;
  identity: Address;
  onVerified?: (kind: WorldKind, txHash: string) => void;
}) {
  const [flows, setFlows] = useState<Record<WorldKind, FlowState>>({
    selfie: { phase: 'idle' },
    document: { phase: 'idle' },
  });

  function set(kind: WorldKind, patch: Partial<FlowState>) {
    setFlows((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  }

  // result -> backend verify (signs claim) -> user submits to their own Identity (Model B).
  async function completeWith(kind: WorldKind, result: unknown) {
    try {
      set(kind, { phase: 'verifying' });
      const claim = await verifyWorldProof(identity, kind, result);
      set(kind, { phase: 'submitting' });
      const txHash = await submitClaim({
        wallet,
        identity,
        topic: BigInt(claim.topic),
        issuer: claim.issuer,
        signature: claim.signature,
        data: claim.data,
      });
      set(kind, { phase: 'done', txHash });
      onVerified?.(kind, txHash);
    } catch (e) {
      set(kind, { phase: 'error', error: e instanceof Error ? e.message : 'Verification failed' });
    }
  }

  async function start(kind: WorldKind) {
    try {
      set(kind, { phase: 'requesting', error: undefined, txHash: undefined });
      const config = await requestWorldProof(kind);
      if (config.mock) {
        // No real World app configured — DEMO_MODE: skip the widget, use a labeled mock result.
        await completeWith(kind, mockResult(kind));
        return;
      }
      set(kind, { phase: 'widget', config });
    } catch (e) {
      set(kind, { phase: 'error', error: e instanceof Error ? e.message : 'Could not start World ID' });
    }
  }

  return (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF]">
          World ID — Real Verification
        </span>
      </div>
      <p className="text-sm text-[#4B5568] mb-5">
        Two real World ID flows. The proof is verified and a compliance claim is signed; you submit it to
        your own on-chain identity. Zero PII is stored — only a hash of the nullifier.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FLOWS.map(({ kind, title, sub, emoji, topic }) => {
          const state = flows[kind];
          const busy = ['requesting', 'widget', 'verifying', 'submitting'].includes(state.phase);
          const done = state.phase === 'done';
          return (
            <div key={kind} className="border border-[#DDE1EA] rounded-xl p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{emoji}</span>
                <span className="font-bold text-[#0D1428] text-sm">{title}</span>
              </div>
              <p className="text-xs text-[#4B5568] mb-1">{sub}</p>
              <p className="text-[10px] font-semibold tracking-wide uppercase text-[#9CA3AF] mb-3">
                → {topic}
              </p>

              <button
                onClick={() => start(kind)}
                disabled={busy || done}
                className="mt-auto text-xs font-semibold px-3 py-2 rounded-lg bg-[#0D1428] text-white hover:bg-[#1c2a4a] transition-colors disabled:opacity-50"
              >
                {done
                  ? '✓ Verified'
                  : state.phase === 'requesting'
                    ? 'Starting…'
                    : state.phase === 'widget'
                      ? 'Open World App…'
                      : state.phase === 'verifying'
                        ? 'Verifying proof…'
                        : state.phase === 'submitting'
                          ? 'Submitting claim…'
                          : `Verify with ${title}`}
              </button>

              {state.txHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${state.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-[#4A9EFF] hover:underline mt-2 break-all"
                >
                  {state.txHash.slice(0, 10)}…{state.txHash.slice(-8)} ↗
                </a>
              )}
              {state.error && (
                <p className="text-[11px] text-red-600 mt-2 break-words">{state.error}</p>
              )}

              {/* v4 widget — only mounted once the backend RP-signs the request. */}
              {state.phase === 'widget' && state.config && (
                <IDKitRequestWidget
                  open
                  onOpenChange={(open) => {
                    if (!open && flows[kind].phase === 'widget') set(kind, { phase: 'idle' });
                  }}
                  app_id={state.config.app_id as `app_${string}`}
                  action={state.config.action}
                  rp_context={state.config.rp_context}
                  allow_legacy_proofs
                  preset={kind === 'selfie' ? selfieCheckLegacy() : passport()}
                  onSuccess={(result) => completeWith(kind, result)}
                  onError={() =>
                    set(kind, { phase: 'error', error: 'World App rejected or cancelled the request' })
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
