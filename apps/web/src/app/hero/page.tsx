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
  newAgentWallet,
  agentTransfer,
  type PassportStatus,
} from '@/lib/hero-chain';
import { shortenAddress } from '@/lib/format';

const SEP = 'https://sepolia.etherscan.io/tx/';

type TxItem = { label: string; hash: string };
type Agent = { address: Address; privateKey: Hex; ensName: string };

const STATUS_STYLE: Record<PassportStatus, string> = {
  NONE: 'bg-[#F0F2F6] text-[#9CA3AF] border-[#DDE1EA]',
  LIMITED: 'bg-amber-50 text-amber-700 border-amber-200',
  GREEN: 'bg-[#EAF7F0] text-[#0B7A4B] border-[#B8E6CE]',
  REVOKED: 'bg-red-50 text-red-700 border-red-200',
};

export default function HeroPage() {
  const { address } = useWallet();
  const wallet = (address ?? null) as Address | null;

  const [label, setLabel] = useState('');
  const [identity, setIdentity] = useState<Address | null>(null);
  const [ensName, setEnsName] = useState<string | null>(null);
  const [ensStatus, setEnsStatus] = useState<string>('—');
  const [status, setStatus] = useState<PassportStatus>('NONE');
  const [personhood, setPersonhood] = useState(false);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentEns, setAgentEns] = useState<{ registration: string; reputation: string } | null>(null);
  const [casaOk, setCasaOk] = useState<string | null>(null);
  const [casaFail, setCasaFail] = useState<string | null>(null);
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

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Resolve an existing identity when a wallet connects (so re-runs pick up prior state).
  useEffect(() => {
    if (!wallet) return;
    getIdentity(wallet).then((id) => id && setIdentity(id)).catch(() => {});
  }, [wallet]);

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
      const hash = await submitClaim({
        wallet,
        identity,
        topic: BigInt(c.topic),
        issuer: c.issuer,
        signature: c.signature,
        data: c.data,
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

  const doCasaTransfer = (retry: boolean) =>
    run(retry ? 'casa-retry' : 'casa', async () => {
      if (!agent || !wallet) return;
      setCasaFail(null);
      try {
        const hash = await agentTransfer({ agentPrivateKey: agent.privateKey, to: wallet });
        setCasaOk(hash);
        addTx('agent transfer', hash);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'transfer reverted';
        // surface the eligibility refusal reason
        const reason = /NotEligible|not eligible|MISSING_KYC|reverted/i.test(msg) ? msg : msg;
        setCasaFail(reason);
        setCasaOk(null);
        throw e;
      }
    });

  const doRevoke = () =>
    run('revoke', async () => {
      if (!identity) return;
      await revokeClaim(identity, 'KYC_VERIFIED', true);
      await refreshStatus();
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
          cut the agent off from Casa Azul&apos;s compliant liquidity.
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

      {/* Step 2 — identity + World KYC -> LIMITED */}
      {wallet &&
        step(2, 'Verify identity (World ID) → passport LIMITED', status === 'LIMITED' || status === 'GREEN', (
          <div className="space-y-3">
            {!identity ? (
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
                  {busy === 'provision' ? 'Generating…' : 'Generate identity + ENS'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-[#4B5568]">
                Identity ready as <span className="font-semibold">{ensName}</span>. Now prove it with World ID.
              </p>
            )}
            {identity && (
              <HeroWorldButton
                kind="document"
                wallet={wallet}
                identity={identity}
                label={label}
                onDone={(h) => {
                  addTx('KYC claim (World)', h);
                  refreshStatus();
                }}
              />
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

      {/* Step 4 — personhood */}
      {identity &&
        (status === 'LIMITED' || status === 'GREEN') &&
        step(4, 'Prove personhood (World Selfie Check)', personhood, (
          <HeroWorldButton
            kind="selfie"
            wallet={wallet!}
            identity={identity}
            label={label}
            onDone={(h) => {
              addTx('personhood claim (World)', h);
              setPersonhood(true);
            }}
          />
        ))}

      {/* Step 5 — create agent */}
      {personhood &&
        step(5, 'Delegate to an agent (new wallet, inherits your identity)', !!agent, (
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

      {/* Step 6 — Casa Azul liquidity */}
      {agent &&
        step(6, 'Casa Azul liquidity — your agent acts', !!casaOk, (
          <div className="space-y-2">
            <p className="text-xs text-[#4B5568]">
              The agent moves Casa Azul&apos;s compliant token (GatedERC20). The gate resolves the
              agent → your identity → your eligibility.
            </p>
            <button
              onClick={() => doCasaTransfer(false)}
              disabled={busy === 'casa'}
              className="text-sm font-semibold px-4 py-2.5 rounded-lg bg-[#0D1428] text-white disabled:opacity-40 w-full"
            >
              {busy === 'casa' ? 'Transacting…' : 'Agent transacts on Casa Azul'}
            </button>
            {casaOk && (
              <a href={`${SEP}${casaOk}`} target="_blank" rel="noreferrer" className="text-[11px] text-[#0B7A4B] hover:underline block">
                ✓ Agent transfer confirmed ↗
              </a>
            )}
          </div>
        ))}

      {/* Step 7 + 8 — the money moment */}
      {casaOk &&
        step(7, 'The money moment — revoke the human', status === 'REVOKED', (
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
                  <span className="font-semibold text-red-600">{ensStatus}</span>. Now the agent retries…
                </p>
                <button
                  onClick={() => doCasaTransfer(true)}
                  disabled={busy === 'casa-retry'}
                  className="text-sm font-semibold px-4 py-2.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40 w-full"
                >
                  {busy === 'casa-retry' ? 'Trying…' : 'Agent retries the transaction'}
                </button>
                {casaFail && (
                  <p className="text-[11px] text-red-600 break-words border border-red-200 bg-red-50 rounded-lg px-3 py-2">
                    ✗ Agent blocked: {casaFail}
                  </p>
                )}
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
