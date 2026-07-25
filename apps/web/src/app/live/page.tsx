'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell, Card, Pill, Btn, short } from '@/components/pk/kit';
import {
  ADDR,
  AGENT_NAME,
  EXPLORER,
  PERSON_NAME,
  readLiveState,
  setRevoked,
  type LiveState,
} from '@/lib/onchain';

const STATUS_TONE: Record<string, 'green' | 'red' | 'slate'> = {
  GREEN: 'green',
  REVOKED: 'red',
  NONE: 'slate',
};

export default function LivePage() {
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await readLiveState());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'read failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleRevoke = async (value: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await setRevoked(value);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'tx failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0D1428]">Live on Sepolia</h1>
          <p className="mt-1 text-sm text-slate-500">
            Read straight from the deployed contracts — compliance resolved through ENS, on-chain.
          </p>
        </div>
        <Btn variant="ghost" onClick={refresh} disabled={busy}>
          ↻ Refresh
        </Btn>
      </div>

      {loading && <Card><p className="text-sm text-slate-500">Reading the chain…</p></Card>}

      {state && (
        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            {/* person */}
            <Card title="Person" subtitle={PERSON_NAME}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">compliance.status</span>
                <Pill tone={STATUS_TONE[state.status] ?? 'slate'}>
                  {state.status === 'GREEN' ? '🟢 ' : state.status === 'REVOKED' ? '🔴 ' : ''}
                  {state.status}
                </Pill>
              </div>
              <p className="mt-3 text-[11px] text-slate-400">
                Resolved live via <span className="font-mono">PassportResolver.text()</span> — no setText, no keeper.
              </p>
            </Card>

            {/* agent */}
            <Card title="Agent" subtitle={AGENT_NAME}>
              <div className="flex flex-wrap gap-2">
                {state.agentVerified ? (
                  <Pill tone="blue">ENSIP-25 verified</Pill>
                ) : (
                  <Pill tone="slate">not verified</Pill>
                )}
                <Pill tone="green">score {state.agentScore}</Pill>
                {state.status === 'GREEN' ? (
                  <Pill tone="green">✓ can act</Pill>
                ) : (
                  <Pill tone="red">blocked (person)</Pill>
                )}
              </div>
              <p className="mt-3 text-[11px] text-slate-400">
                Inherits the person&apos;s eligibility (Model A). Revoke the person → the agent drops too.
              </p>
            </Card>
          </div>

          {/* money moment */}
          <Card
            title="The money moment"
            subtitle="One revoke → every surface refuses at once, live."
            className={state.kycRevoked ? 'ring-2 ring-red-200' : 'ring-2 ring-teal-100'}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">Person KYC:</span>
                {state.kycRevoked ? <Pill tone="red">REVOKED</Pill> : <Pill tone="green">✓ valid</Pill>}
              </div>
              {state.kycRevoked ? (
                <Btn variant="ghost" onClick={() => toggleRevoke(false)} disabled={busy}>
                  {busy ? 'Sending…' : 'Re-issue KYC'}
                </Btn>
              ) : (
                <Btn variant="danger" onClick={() => toggleRevoke(true)} disabled={busy}>
                  {busy ? 'Sending…' : 'Revoke KYC'}
                </Btn>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Signs from the agent wallet (`AGENT_ROLE`). Watch the status + agent flip after it confirms.
            </p>
          </Card>

          {err && <p className="text-xs text-red-500">{err}</p>}

          {/* contracts */}
          <Card title="On-chain">
            <div className="space-y-1.5 text-xs">
              <Row label="PassportResolver" addr={ADDR.resolver} />
              <Row label="ClaimIssuer" addr={ADDR.claimIssuer} />
              <Row label="Person identity" addr={ADDR.identity} />
              <Row label="Agent wallet" addr={ADDR.agent} />
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}

function Row({ label, addr }: { label: string; addr: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <a
        href={`${EXPLORER}/address/${addr}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[#4A9EFF] hover:underline"
      >
        {short(addr)} ↗
      </a>
    </div>
  );
}
