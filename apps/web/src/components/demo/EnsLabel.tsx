/**
 * Who an actor IS, on both demo pages: their ENS name, with the wallet demoted to
 * the hover. A hex address identifies nobody — the name is the identifier, and on
 * PassportResolver it is the only one that also carries a live verdict.
 *
 * An AGENT gets a second reading for free. `bot.ana.casaazul.eth` is drawn as
 * `bot.` + `ana.casaazul.eth`, the parent picked out in the brand gradient, because
 * the parent name is its principal's: the agent is a subname of a person, resolves
 * to that person's identity, and goes dark the moment that person is revoked.
 *
 * Everything here is chain- or config-derived text, rendered as text.
 */
import { StatusPill, toneForStatus } from './StatusPill';
import type { DemoEns } from './useDemoWorld';

const short = (value?: string | null) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—');

/**
 * The name as a card heading. Falls back to the shortened wallet when there is no
 * name at all, so a page never renders a blank identifier.
 */
export function EnsName({ ens, wallet }: { ens?: DemoEns | null; wallet?: string | null }) {
  if (!ens?.name) return <span className="font-mono text-sm text-[#0D1428]">{short(wallet)}</span>;

  // the label is whatever the principal's name is NOT — `bot.` of `bot.ana.casaazul.eth`
  const parent = ens.principal?.name;
  const prefix = parent && ens.name.endsWith(parent) ? ens.name.slice(0, -parent.length) : null;

  return (
    <span title={wallet ?? undefined} className="break-all">
      {prefix ? (
        <>
          {prefix}
          <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
            {parent}
          </span>
        </>
      ) : (
        ens.name
      )}
    </span>
  );
}

/**
 * `compliance.status` as the resolver computes it — GREEN, REVOKED or NONE, verbatim.
 * Renders an em dash when the read failed, so an unreachable resolver never reads as
 * a compliant name.
 */
export function EnsStatus({ ens }: { ens?: DemoEns | null }) {
  if (!ens?.status) return <span className="text-[11px] text-[#9CA3AF]">—</span>;
  return (
    <StatusPill tone={toneForStatus(ens.status)} title={`${ens.name} · text(node, "compliance.status")`}>
      {ens.status}
    </StatusPill>
  );
}

/// The wallet, for the row it is demoted to: mono, muted, full address on hover.
export function WalletValue({ address }: { address?: string | null }) {
  return (
    <span className="font-mono text-[11px] text-[#9CA3AF]" title={address ?? undefined}>
      {short(address)}
    </span>
  );
}
