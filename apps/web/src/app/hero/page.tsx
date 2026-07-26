'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Address, Hex } from 'viem';
import { useWallet, WalletConnectControl } from '@/components/shell/AppShell';
import { HeroWorldButton } from '@/components/hero/HeroWorldButton';
import { submitClaim, getIdentity, TOPICS } from '@/lib/world-chain';
import {
  provisionUser,
  linkAgent as apiLinkAgent,
  mockAccreditedClaim,
  revokeClaim,
} from '@/lib/hero-api';
import {
  readPassportStatus,
  readComplianceStatus,
  readAgentEns,
  readPoolRefusal,
  newAgentWallet,
  agentTransfer,
  agentSwap,
  RefusedError,
  type PassportStatus,
  type Surface,
} from '@/lib/hero-chain';
import { useEthProvider } from '@/lib/useEthProvider';
import { shortenAddress } from '@/lib/format';

const SEP = 'https://sepolia.etherscan.io/tx/';

type TxItem = { label: string; hash: string };
type Agent = { address: Address; privateKey: Hex; ensName: string };
/** What one enforcement surface did on the agent's last attempt. */
type SurfaceResult = { hash: string | null; refusal: { code: string | null; message: string } | null };

const STATUS_STYLE: Record<PassportStatus, string> = {
  NONE: 'bg-[#F0F2F6] text-[#9CA3AF] border-[#DDE1EA]',
  LIMITED: 'bg-amber-50 text-amber-700 border-amber-200',
  GREEN: 'bg-[#EAF7F0] text-[#0B7A4B] border-[#B8E6CE]',
  REVOKED: 'bg-red-50 text-red-700 border-red-200',
};

/**
 * The two surfaces the agent acts on. They share ONE EligibilityGate and one identity, which is the
 * whole point: revoking the person refuses both at once, in the same transaction the agent signs.
 */
const SURFACES: { key: Surface; title: string; note: string; action: string; tx: string }[] = [
  {
    key: 'token',
    title: 'Compliant token — GatedERC20 transfer',
    note: 'The token gates its own transfers: it resolves the agent to your identity before it moves.',
    action: 'Agent transfers Casa Azul tokens',
    tx: 'agent transfer (GatedERC20)',
  },
  {
    key: 'pool',
    title: 'Compliant pool — Uniswap v4 swap',
    note: 'A real v4 swap (mCASA to mUSDC). ComplianceHook runs beforeSwap and asks the same gate.',
    action: 'Agent swaps in the compliant pool',
    tx: 'agent swap (Uniswap v4)',
  },
];

const EMPTY_SURFACE: SurfaceResult = { hash: null, refusal: null };

/// One row per attempt: the surface acting (step 5) and the same surface retrying (step 6) are
/// separate outcomes, and doubles as the `busy` key so only the clicked button spins.
const attemptKey = (surface: Surface, retry: boolean) => `${surface}${retry ? '-retry' : ''}`;

export default function HeroPage() {
  const { address } = useWallet();
  const wallet = (address ?? null) as Address | null;
  const getProvider = useEthProvider();

  const [label, setLabel] = useState('');
  const [identity, setIdentity] = useState<Address | null>(null);
  const [ensName, setEnsName] = useState<string | null>(null);
  const [ensStatus, setEnsStatus] = useState<string>('—');
  const [status, setStatus] = useState<PassportStatus>('NONE');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentEns, setAgentEns] = useState<{ registration: string; reputation: string } | null>(null);
  // Keyed by attempt ('token', 'pool', and their '-retry' twins) so the money moment's rows start
  // empty instead of inheriting the green check the same surface earned before the revocation.
  const [attempts, setAttempts] = useState<Record<string, SurfaceResult>>({});
  // The pool's own live view of the agent: the reason code its next swap would revert with, or null.
  const [poolReason, setPoolReason] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const addTx = useCallback((label: string, hash?: string | null) => {
    if (hash) setTxs((p) => [{ label, hash }, ...p]);
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!identity || !ensName) return;
    const [s, e] = await Promise.all([
      readPassportStatus(identity, ensName).catch(() => 'NONE' as PassportStatus),
      readComplianceStatus(ensName).catch(() => '—'),
    ]);
    setStatus(s);
    setEnsStatus(e);
  }, [identity, ensName]);

  // Read the pool's standing on the agent alongside the passport — it is the fourth surface's own
  // answer, not ours, so the revoke shows up here without the agent having to try anything.
  const refreshPoolReason = useCallback(async () => {
    if (!agent) return;
    setPoolReason(await readPoolRefusal(agent.address).catch(() => null));
  }, [agent]);

  useEffect(() => {
    refreshPoolReason();
  }, [refreshPoolReason, status]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Restore per-wallet state on connect (ENS name isn't reverse-resolvable, so we cache it) + read
  // the on-chain identity as a fallback.
  useEffect(() => {
    if (!wallet) return;
    try {
      const raw = localStorage.getItem(`hero:${wallet}`);
      if (raw) {
        const s = JSON.parse(raw) as { identity?: Address; ensName?: string; agent?: Agent };
        if (s.identity) setIdentity(s.identity);
        if (s.ensName) setEnsName(s.ensName);
        if (s.agent) setAgent(s.agent);
      }
    } catch {
      /* ignore */
    }
    getIdentity(wallet).then((id) => id && setIdentity(id)).catch(() => {});
  }, [wallet]);

  // Persist so a refresh keeps identity / ENS / agent (agent key is a demo throwaway).
  useEffect(() => {
    if (!wallet) return;
    try {
      localStorage.setItem(`hero:${wallet}`, JSON.stringify({ identity, ensName, agent }));
    } catch {
      /* ignore */
    }
  }, [wallet, identity, ensName, agent]);

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${key} failed`);
    } finally {
      setBusy(null);
    }
  }

  const doProvision = () =>
    run('provision', async () => {
      if (!wallet) return;
      const r = await provisionUser(wallet, label);
      setIdentity(r.identity);
      setEnsName(r.ensName);
      addTx('createIdentity', r.txs.createIdentity);
      addTx('bind ENS', r.txs.bindEns);
      const e = await readComplianceStatus(r.ensName).catch(() => '—');
      setEnsStatus(e);
    });

  const doAccredited = () =>
    run('accredited', async () => {
      if (!wallet || !identity) return;
      const c = await mockAccreditedClaim(identity);
      const provider = await getProvider();
      const hash = await submitClaim({
        wallet,
        identity,
        topic: BigInt(c.topic),
        issuer: c.issuer,
        signature: c.signature,
        data: c.data,
        provider,
      });
      addTx('accredited claim', hash);
      await refreshStatus();
    });

  const doCreateAgent = () =>
    run('agent', async () => {
      if (!identity) return;
      const a = newAgentWallet();
      const r = await apiLinkAgent(a.address, identity, label);
      const ag: Agent = { address: a.address, privateKey: a.privateKey, ensName: r.agentEnsName };
      setAgent(ag);
      addTx('linkAgent', r.txs.linkAgent);
      addTx('agent ENS + score', r.txs.bindEns);
      const e = await readAgentEns(ag.ensName, ag.address).catch(() => null);
      setAgentEns(e);
    });

  /**
   * One agent action, on one surface. A REFUSAL is the demo, not a failure: it lands in the surface's
   * own panel with the chain's reason code, and only a genuine error (RPC, gas) reaches the banner.
   */
  const doSurface = (surface: Surface, retry: boolean) => {
    const key = attemptKey(surface, retry);
    return run(key, async () => {
      if (!agent || !wallet) return;
      const spec = SURFACES.find((s) => s.key === surface)!;
      setAttempts((p) => ({ ...p, [key]: EMPTY_SURFACE }));
      try {
        const hash =
          surface === 'token'
            ? await agentTransfer({ agentPrivateKey: agent.privateKey, to: wallet })
            : await agentSwap({ agentPrivateKey: agent.privateKey });
        setAttempts((p) => ({ ...p, [key]: { hash, refusal: null } }));
        addTx(spec.tx, hash);
      } catch (e) {
        if (!(e instanceof RefusedError)) throw e;
        const message = e.code
          ? `Refused on-chain — reason code ${e.code}`
          : 'Refused on-chain by the compliance check';
        setAttempts((p) => ({ ...p, [key]: { hash: null, refusal: { code: e.code, message } } }));
      } finally {
        await refreshPoolReason();
      }
    });
  };

  const doRevoke = () =>
    run('revoke', async () => {
      if (!identity) return;
      await revokeClaim(identity, 'KYC_VERIFIED', true);
      await refreshStatus();
      await refreshPoolReason();
    });

  const step = (n: number, title: string, done: boolean, children: React.ReactNode) => (
    <div className="bg-white border border-[#DDE1EA] rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
            done ? 'bg-[#0B7A4B] text-white' : 'bg-[#0D1428] text-white'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <h3 className="font-bold text-[#0D1428] text-sm">{title}</h3>
      </div>
      {children}
    </div>
  );

  /**
   * One enforcement surface: what it is, the agent's button, and the outcome. `retry` is the same row
   * after the revocation — same call, opposite answer.
   */
  const surfaceRow = (spec: (typeof SURFACES)[number], retry: boolean) => {
    const key = attemptKey(spec.key, retry);
    const result = attempts[key] ?? EMPTY_SURFACE;
    return (
      <div key={key} className="rounded-xl border border-[#DDE1EA] bg-[#F8F9FC] p-3 space-y-2">
        <p className="text-xs font-semibold text-[#0D1428]">{spec.title}</p>
        {!retry && <p className="text-[11px] text-[#9CA3AF]">{spec.note}</p>}
        <button
          onClick={() => doSurface(spec.key, retry)}
          disabled={busy === key}
          className={`text-sm font-semibold px-4 py-2.5 rounded-lg w-full disabled:opacity-40 ${
            retry
              ? 'border border-red-300 text-red-700 hover:bg-red-50'
              : 'bg-[#0D1428] text-white hover:bg-[#141E38]'
          }`}
        >
          {busy === key ? 'Transacting…' : retry ? 'Retry' : spec.action}
        </button>
        {result.hash && (
          <a
            href={`${SEP}${result.hash}`}
            target="_blank"
            rel="noreferrer"
            className="block text-[11px] text-[#0B7A4B] hover:underline"
          >
            ✓ Confirmed on Sepolia ↗
          </a>
        )}
        {result.refusal && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-1">
            <p className="text-[11px] text-red-700">✗ {result.refusal.message}</p>
            {result.refusal.code && (
              <span className="inline-block font-mono text-[10px] font-semibold text-red-700 border border-red-200 bg-white rounded px-2 py-0.5">
                {result.refusal.code}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  // One surface cleared is enough to unlock the money moment: the demo must never be stuck behind
  // a surface that is having an off day.
  const surfaceCleared = SURFACES.some((s) => attempts[attemptKey(s.key, false)]?.hash);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
      <div>
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">
          PassportKit — live on Sepolia
        </p>
        <h1 className="text-2xl font-bold text-[#0D1428]">
          One identity.{' '}
          <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
            Humans and their agents.
          </span>
        </h1>
        <p className="text-sm text-[#4B5568] mt-1">
          Verify with World ID, get a live ENS name, delegate to an agent — then watch one revocation
          cut the agent off from Casa Azul&apos;s compliant token and its Uniswap v4 pool at once.
        </p>
      </div>

      {/* ENS throughline card */}
      {ensName && (
        <div className="rounded-2xl p-5 bg-[#0D1428] text-white">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-[#8FA0C0] mb-1">
            Your ENS identity (resolves live on-chain)
          </p>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-lg font-bold bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
              {ensName}
            </span>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${STATUS_STYLE[status]}`}>
              {status}
            </span>
          </div>
          <p className="text-[11px] text-[#8FA0C0] mt-2">
            <span className="font-mono">compliance.status</span> ={' '}
            <span className="text-white font-semibold">{ensStatus}</span> · identity{' '}
            <span className="font-mono">{identity ? shortenAddress(identity) : '—'}</span>
          </p>
          {agent && (
            <p className="text-[11px] text-[#8FA0C0] mt-1">
              <span className="text-white font-semibold">{agent.ensName}</span> ·{' '}
              <span className="font-mono">agent-registration</span> ={' '}
              <span className="text-white">{agentEns?.registration ?? '—'}</span> ·{' '}
              <span className="font-mono">reputation</span> ={' '}
              <span className="text-white">{agentEns?.reputation ?? '—'}</span>
            </p>
          )}
        </div>
      )}

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-600">{err}</div>
      )}

      {/* Step 1 — connect */}
      {step(1, 'Login & wallet', !!wallet, (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-[#4B5568]">
            {wallet ? (
              <>Connected <span className="font-mono text-[#0D1428]">{shortenAddress(wallet)}</span></>
            ) : (
              'Login with Privy to generate your wallet.'
            )}
          </p>
          <WalletConnectControl />
        </div>
      ))}

      {/* Step 2 — identity + live ENS + World Selfie Check -> KYC -> LIMITED */}
      {wallet &&
        step(2, 'Verify identity (World ID) → passport LIMITED', status === 'LIMITED' || status === 'GREEN', (
          <div className="space-y-3">
            {!ensName ? (
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="choose your ENS label (e.g. luiz)"
                  className="flex-1 min-w-[180px] text-sm border border-[#DDE1EA] rounded-lg px-3 py-2"
                />
                <button
                  onClick={doProvision}
                  disabled={!label || busy === 'provision'}
                  className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#0D1428] text-white disabled:opacity-40"
                >
                  {busy === 'provision' ? 'Generating… (~45s on Sepolia)' : 'Generate identity + ENS'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-[#4B5568]">
                Identity ready as <span className="font-semibold">{ensName}</span>. Now prove you&apos;re a
                real, live human with World ID — Casa Azul accepts it as your onboarding signal.
              </p>
            )}
            {identity && ensName && (
              <div className="space-y-2">
                <HeroWorldButton
                  kind="selfie"
                  wallet={wallet}
                  identity={identity}
                  label={label}
                  topicName="KYC_VERIFIED"
                  onDone={(h) => {
                    addTx('KYC via Selfie Check (World)', h);
                    refreshStatus();
                  }}
                />
                <details className="text-[11px] text-[#9CA3AF]">
                  <summary className="cursor-pointer">Have a passport-verified World App? Use Identity Check instead</summary>
                  <div className="mt-2">
                    <HeroWorldButton
                      kind="document"
                      wallet={wallet}
                      identity={identity}
                      label={label}
                      topicName="KYC_VERIFIED"
                      onDone={(h) => {
                        addTx('KYC via Identity Check (World)', h);
                        refreshStatus();
                      }}
                    />
                  </div>
                </details>
              </div>
            )}
          </div>
        ))}

      {/* Step 3 — accredited -> GREEN */}
      {(status === 'LIMITED' || status === 'GREEN') &&
        step(3, 'Add accredited (labeled mock) → passport GREEN', status === 'GREEN', (
          <button
            onClick={doAccredited}
            disabled={busy === 'accredited' || status === 'GREEN'}
            className="text-sm font-semibold px-4 py-2.5 rounded-lg bg-[#0D1428] text-white disabled:opacity-40 w-full"
          >
            {status === 'GREEN' ? '✓ Accredited' : busy === 'accredited' ? 'Submitting…' : 'Add accredited claim (mock)'}
          </button>
        ))}

      {/* Step 4 — create agent */}
      {status === 'GREEN' &&
        step(4, 'Delegate to an agent (new wallet, inherits your identity)', !!agent, (
          <div className="space-y-2">
            {!agent ? (
              <button
                onClick={doCreateAgent}
                disabled={busy === 'agent'}
                className="text-sm font-semibold px-4 py-2.5 rounded-lg bg-[#0D1428] text-white disabled:opacity-40 w-full"
              >
                {busy === 'agent' ? 'Creating agent…' : 'Create my agent'}
              </button>
            ) : (
              <p className="text-xs text-[#4B5568]">
                Agent <span className="font-mono text-[#0D1428]">{shortenAddress(agent.address)}</span> →{' '}
                <span className="font-semibold">{agent.ensName}</span> (inherits your eligibility, Model A).
              </p>
            )}
          </div>
        ))}

      {/* Step 6 — Casa Azul liquidity, on BOTH enforcement surfaces */}
      {agent &&
        step(5, 'Casa Azul liquidity — your agent acts', surfaceCleared, (
          <div className="space-y-3">
            <p className="text-xs text-[#4B5568]">
              Two enforcement surfaces, one decision. Both resolve the agent → your identity → your
              eligibility, and both ask the same <span className="font-mono">EligibilityGate</span>.
            </p>
            {SURFACES.map((s) => surfaceRow(s, false))}
            <p className="text-[11px] text-[#9CA3AF]">
              The pool&apos;s own view of your agent —{' '}
              <span className="font-mono">reasonFor({shortenAddress(agent.address)})</span> ={' '}
              <span className="font-semibold text-[#4B5568]">{poolReason ?? 'eligible'}</span>
            </p>
          </div>
        ))}

      {/* Step 7 + 8 — the money moment: one revoke, every surface refuses */}
      {surfaceCleared &&
        step(6, 'The money moment — revoke the human', status === 'REVOKED', (
          <div className="space-y-3">
            <button
              onClick={doRevoke}
              disabled={busy === 'revoke' || status === 'REVOKED'}
              className="text-sm font-semibold px-4 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 w-full"
            >
              {status === 'REVOKED' ? '✓ Revoked' : busy === 'revoke' ? 'Revoking…' : 'Revoke user KYC (issuer)'}
            </button>
            {status === 'REVOKED' && (
              <>
                <p className="text-xs text-[#4B5568]">
                  ENS <span className="font-mono">compliance.status</span> flipped to{' '}
                  <span className="font-semibold text-red-600">{ensStatus}</span>, and the pool already
                  says <span className="font-mono font-semibold text-red-600">{poolReason ?? '—'}</span>{' '}
                  about your agent. Nothing was done to the agent itself. Now it retries — both surfaces.
                </p>
                {SURFACES.map((s) => surfaceRow(s, true))}
              </>
            )}
          </div>
        ))}

      {/* tx log */}
      {txs.length > 0 && (
        <div className="bg-[#0D1428] rounded-2xl p-4">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-[#8FA0C0] mb-2">
            On-chain transactions (Sepolia)
          </p>
          <div className="space-y-1">
            {txs.map((t, i) => (
              <a
                key={i}
                href={`${SEP}${t.hash}`}
                target="_blank"
                rel="noreferrer"
                className="flex justify-between text-[11px] text-[#8FA0C0] hover:text-white font-mono"
              >
                <span>{t.label}</span>
                <span>{t.hash.slice(0, 10)}…{t.hash.slice(-6)} ↗</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
