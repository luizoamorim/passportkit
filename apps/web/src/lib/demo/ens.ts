/**
 * Demo runtime — the ENS layer: what every actor is CALLED, and what their name
 * says about them right now.
 *
 * PassportResolver is enforcement surface #3, a tenant-aware READ-THROUGH resolver:
 * it stores no records at all. `text(node, 'compliance.status')` is computed on every
 * read from the same EligibilityGate the pools and the treasury ask, so a name flips
 * to REVOKED the instant the issuer's latch closes. There is no setText anywhere in
 * this system, and nothing here caches.
 *
 * The one thing that is NOT chain data is which name belongs to which demo actor —
 * the names were registered by hand under the tenant — so that mapping is config and
 * lives in ENS_LABELS below, once, derived from the actor key everywhere else.
 *
 * Every read is best-effort: a chain without this resolver (local anvil) or a name
 * that was never bound must degrade to the wallet address, never take
 * `GET /api/demo/world` down with it.
 *
 * SERVER ONLY — it rides chain.ts's publicClient.
 */
import { namehash } from 'viem/ens';
import type { Address, Hex } from 'viem';

import { RESOLVER_ABI } from './abis';
import { ACTORS, actorAddress, publicClient, type DemoActor } from './chain';

// ---------------------------------------------------------------- config

/**
 * Deployed on Sepolia (docs/DEPLOYMENTS.md). NOT in demo-addresses.json — DeployAll.s.sol
 * deploys the compliance stack, never ENS — so it is read from the environment with the
 * live address as the default, and the variable is named to agree with the API's own
 * `PASSPORT_RESOLVER_ADDRESS`. A redeployed resolver is an env change, not a code edit.
 */
const RESOLVER = (process.env.PASSPORT_RESOLVER_ADDRESS ??
  '0xB31f41e8258fFb3B8Ab0d0c0FB131516A16271ce') as Address;

/// The tenant every demo name hangs off.
const TENANT = 'casaazul.eth';

/**
 * DEMO CONFIG, not chain data: the ENS label each actor answers to. Nothing on-chain
 * maps a wallet back to a name, so the mapping is written down here and nowhere else —
 * pages derive a name from the actor key rather than carrying a string of their own.
 *
 * `principal` is the whole agent story in one field. The concierge is not a party of
 * its own: it is ANA's agent (Model A `linkAgent`), it holds no claims, and the
 * resolver resolves its name to HER identity. That is why its name is a SUBNAME of
 * hers — `bot.ana.casaazul.eth` reads GREEN exactly while `ana.casaazul.eth` does, and
 * flips to REVOKED with her.
 */
const ENS_LABELS: Record<DemoActor, { label: string; principal?: DemoActor }> = {
  operator: { label: 'operator' },
  ana: { label: 'ana' },
  rui: { label: 'rui' },
  plumber: { label: 'plumber' },
  concierge: { label: 'bot', principal: 'ana' },
};

/// operator -> `operator.casaazul.eth`; concierge -> `bot.ana.casaazul.eth`. An agent's
/// name is derived THROUGH its principal's, because that is what it is: a subname of it.
export function ensNameOf(actor: DemoActor): string {
  const entry = ENS_LABELS[actor];
  return `${entry.label}.${entry.principal ? ensNameOf(entry.principal) : TENANT}`;
}

// ---------------------------------------------------------------- shape

/** One actor's name, as the demo pages consume it. */
export interface DemoEns {
  /** the live ENS name — derived from the actor key, never written out in a page */
  name: string;
  /**
   * `text(node, 'compliance.status')` verbatim: `NONE` | `GREEN` | `REVOKED`.
   * null means the resolver could not be read — the page falls back to the wallet.
   */
  status: string | null;
  /** an AGENT only: the principal whose identity this name resolves to. null for a person. */
  principal: { actor: DemoActor; name: string; wallet: Address } | null;
  /** ENSIP-25 registration (agents only): '1' while the link is live, '' when it is not. */
  registration: string | null;
  /** ENSIP-25 reputation (agents only). */
  reputation: string | null;
}

// ---------------------------------------------------------------- reads

/// The demo actors that are AGENTS — the ones with a principal, and the only ones with
/// ENSIP-25 records to read.
const AGENTS = ACTORS.filter((actor) => ENS_LABELS[actor].principal);

type ResolverCall = { address: Address; abi: typeof RESOLVER_ABI; functionName: string; args: unknown[] };

const textCall = (node: Hex, key: string): ResolverCall => ({
  address: RESOLVER,
  abi: RESOLVER_ABI,
  functionName: 'text',
  args: [node, key],
});

/**
 * A batch of resolver reads through Multicall3, each answer null when it did not come back.
 *
 * Batched deliberately: `GET /api/demo/world` already fans out ~50 reads at once and a
 * public Sepolia endpoint rate-limits on throughput — it answers 429, which viem raises as
 * "HTTP request failed" and which would take the whole world read down. So the name layer
 * costs a round trip, not one per record. A chain with no Multicall3 — or no resolver at
 * this address, as on local anvil — makes the whole batch null and every page falls back
 * to the wallet; `allowFailure` keeps ONE unreadable record from doing the same to the
 * rest of the batch.
 *
 * null therefore means UNREAD, and is never confused with the empty string the resolver
 * answers with for a record it simply has nothing to say about.
 */
async function readBatch(calls: ResolverCall[]): Promise<(string | null)[]> {
  if (calls.length === 0) return [];
  try {
    const results = (await publicClient.multicall({
      contracts: calls as never,
      allowFailure: true,
    })) as unknown as { status: string; result?: unknown }[];
    return results.map((r) => (r.status === 'success' ? (r.result as string) : null));
  } catch {
    return calls.map(() => null);
  }
}

/**
 * Every actor's name and what the resolver says about it right now — the whole ENS layer
 * of one world read, in two round trips: the statuses (plus each agent's two ENSIP-25 key
 * derivations, which the resolver computes from the agent's wallet), then the records
 * those keys name.
 *
 * The names themselves are config, so they are always present; every chain-derived field
 * degrades to null.
 */
export async function ensWorld(): Promise<Record<DemoActor, DemoEns>> {
  const nodes = Object.fromEntries(ACTORS.map((actor) => [actor, namehash(ensNameOf(actor))])) as Record<
    DemoActor,
    Hex
  >;

  // round one: a status per name, and the two record keys per agent, in that order
  const first = await readBatch([
    ...ACTORS.map((actor) => textCall(nodes[actor], 'compliance.status')),
    ...AGENTS.flatMap((actor) => [
      { address: RESOLVER, abi: RESOLVER_ABI, functionName: 'agentRegistrationKey', args: [actorAddress(actor)] },
      { address: RESOLVER, abi: RESOLVER_ABI, functionName: 'agentReputationKey', args: [actorAddress(actor)] },
    ]),
  ]);
  const statuses = first.slice(0, ACTORS.length);
  const keys = first.slice(ACTORS.length);

  // round two: the records those keys name. An agent whose key derivation did not come
  // back has nothing to look up, so it drops out rather than reserving a slot.
  const keyed = AGENTS.map((actor, i) => ({ actor, keys: [keys[i * 2], keys[i * 2 + 1]] })).filter(
    (entry) => entry.keys[0] && entry.keys[1],
  );
  const records = await readBatch(
    keyed.flatMap((entry) => entry.keys.map((key) => textCall(nodes[entry.actor], key as string))),
  );
  const agentRecords = new Map(
    keyed.map((entry, i) => [entry.actor, { registration: records[i * 2], reputation: records[i * 2 + 1] }]),
  );

  return Object.fromEntries(
    ACTORS.map((actor, i) => {
      const principal = ENS_LABELS[actor].principal ?? null;
      return [
        actor,
        {
          name: ensNameOf(actor),
          // a name the resolver has no verdict for is as unknown as one it never answered
          status: statuses[i] || null,
          principal: principal
            ? { actor: principal, name: ensNameOf(principal), wallet: actorAddress(principal) }
            : null,
          registration: agentRecords.get(actor)?.registration ?? null,
          reputation: agentRecords.get(actor)?.reputation ?? null,
        },
      ];
    }),
  ) as Record<DemoActor, DemoEns>;
}

// Deriving five addresses from five private keys is real work; the map never changes.
let walletNames: Map<string, string> | null = null;

/// wallet -> its ENS name, for the rows that carry an address and no actor key (the
/// treasury's vendor, say). null when the wallet is not one of the demo actors.
export function ensNameForWallet(wallet: Address): string | null {
  walletNames ??= new Map(ACTORS.map((actor) => [actorAddress(actor).toLowerCase(), ensNameOf(actor)]));
  return walletNames.get(wallet.toLowerCase()) ?? null;
}
