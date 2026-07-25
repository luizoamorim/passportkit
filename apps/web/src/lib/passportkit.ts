'use client';

/**
 * PassportKit demo service — MOCK-first.
 *
 * The whole flow (create identity -> verify claims -> eligibility -> agents -> revoke money moment)
 * runs client-side against an in-memory + localStorage store so the UI is fully clickable BEFORE the
 * Sepolia deploy. When the contracts are live, swap the mock functions for the real backend/viem
 * calls (endpoints already exist: /identity/create, /identity/link-agent, /issuer/mock-claim,
 * /issuer/revoke, /eligibility/:wallet). The mirrors the on-chain logic (policies, revocation latch,
 * Model-A agent inheritance) so the demo behaves like the real thing.
 */

export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK !== 'false'; // default ON until addresses land
export const ENS_PARENT = process.env.NEXT_PUBLIC_ENS_PARENT_NAME ?? 'casaazul.eth';

export type Topic = 'KYC_VERIFIED' | 'PROOF_OF_PERSONHOOD' | 'ACCREDITED_INVESTOR';
export const TOPICS: Topic[] = ['KYC_VERIFIED', 'PROOF_OF_PERSONHOOD', 'ACCREDITED_INVESTOR'];

export type PassportStatus = 'NONE' | 'LIMITED' | 'GREEN' | 'RED';

export type Eligibility = { ok: boolean; reason: string };

export type Agent = {
  wallet: string;
  label: string;
  subname: string; // e.g. bot1.casaazul.eth
  score: number; // reputation (demo)
  verified: boolean; // ENSIP-25 agent-registration
  eligibleDealRoom: boolean; // inherits the person's eligibility (Model A)
};

export type TxRow = { label: string; hash: string; at: number };

export type PassportState = {
  wallet: string;
  identity: string | null;
  claims: Record<Topic, boolean>; // submitted + valid
  revoked: Record<Topic, boolean>; // issuer latch
  status: PassportStatus;
  dealRoom: Eligibility; // policy #1 = [KYC]
  investor: Eligibility; // policy #2 = [KYC, ACCREDITED]
  agents: Agent[];
  txs: TxRow[];
};

type Store = {
  identity: string | null;
  claims: Record<Topic, boolean>;
  revoked: Record<Topic, boolean>;
  agents: Agent[];
  txs: TxRow[];
};

const AGENT_LABELS = ['atlas', 'nova', 'orion', 'vega', 'lyra', 'juno'];

// --- deterministic-ish fake hex (browser Math.random is fine here) ---
function fakeHex(bytes: number): string {
  let s = '0x';
  for (let i = 0; i < bytes * 2; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return s;
}
const fakeTxHash = () => fakeHex(32);
const fakeAddress = () => fakeHex(20);

function emptyStore(): Store {
  return {
    identity: null,
    claims: { KYC_VERIFIED: false, PROOF_OF_PERSONHOOD: false, ACCREDITED_INVESTOR: false },
    revoked: { KYC_VERIFIED: false, PROOF_OF_PERSONHOOD: false, ACCREDITED_INVESTOR: false },
    agents: [],
    txs: [],
  };
}

const key = (wallet: string) => `passportkit:${wallet.toLowerCase()}`;

function load(wallet: string): Store {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const raw = window.localStorage.getItem(key(wallet));
    if (!raw) return emptyStore();
    return { ...emptyStore(), ...(JSON.parse(raw) as Store) };
  } catch {
    return emptyStore();
  }
}

function save(wallet: string, s: Store) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key(wallet), JSON.stringify(s));
}

function pushTx(s: Store, label: string) {
  s.txs = [{ label, hash: fakeTxHash(), at: Date.now() }, ...s.txs].slice(0, 20);
}

// --- eligibility + status logic (mirrors the contracts) ---
function valid(s: Store, t: Topic): boolean {
  return s.claims[t] && !s.revoked[t]; // revocation latch hides a claim
}

function computeDealRoom(s: Store): Eligibility {
  if (!s.identity) return { ok: false, reason: 'NO_IDENTITY' };
  if (!valid(s, 'KYC_VERIFIED')) return { ok: false, reason: 'MISSING_KYC' };
  return { ok: true, reason: 'OK' };
}

function computeInvestor(s: Store): Eligibility {
  if (!s.identity) return { ok: false, reason: 'NO_IDENTITY' };
  if (!valid(s, 'KYC_VERIFIED')) return { ok: false, reason: 'MISSING_KYC' };
  if (!valid(s, 'ACCREDITED_INVESTOR')) return { ok: false, reason: 'MISSING_ACCREDITED' };
  return { ok: true, reason: 'OK' };
}

function computeStatus(s: Store): PassportStatus {
  if (!s.identity) return 'NONE';
  // KYC failed/revoked after being needed -> RED (hard block)
  if (s.claims.KYC_VERIFIED && s.revoked.KYC_VERIFIED) return 'RED';
  if (!valid(s, 'KYC_VERIFIED')) return 'NONE';
  if (valid(s, 'ACCREDITED_INVESTOR')) return 'GREEN';
  return 'LIMITED';
}

function project(wallet: string, s: Store): PassportState {
  const dealRoom = computeDealRoom(s);
  const agents = s.agents.map((a) => ({ ...a, eligibleDealRoom: dealRoom.ok })); // Model A inheritance
  return {
    wallet,
    identity: s.identity,
    claims: s.claims,
    revoked: s.revoked,
    status: computeStatus(s),
    dealRoom,
    investor: computeInvestor(s),
    agents,
    txs: s.txs,
  };
}

async function delay<T>(v: T, ms = 500): Promise<T> {
  await new Promise((r) => setTimeout(r, ms));
  return v;
}

// ---------------- public API (mock now; swap to real backend later) ----------------

export async function getState(wallet: string): Promise<PassportState> {
  return project(wallet, load(wallet));
}

export async function createIdentity(wallet: string): Promise<PassportState> {
  const s = load(wallet);
  if (!s.identity) {
    s.identity = fakeAddress();
    pushTx(s, 'createIdentity');
    save(wallet, s);
  }
  return delay(project(wallet, s));
}

/** Verify a claim (mock World / KYC / accredited evidence -> issuer signs -> user submits). */
export async function verifyClaim(wallet: string, topic: Topic): Promise<PassportState> {
  const s = load(wallet);
  if (!s.identity) throw new Error('create your identity first');
  s.claims[topic] = true;
  s.revoked[topic] = false;
  pushTx(s, `submitClaim ${topic}`);
  save(wallet, s);
  return delay(project(wallet, s));
}

/** The money moment: issuer revokes a claim (latch). Cascades to every surface + every agent. */
export async function revokeClaim(wallet: string, topic: Topic): Promise<PassportState> {
  const s = load(wallet);
  s.revoked[topic] = true;
  pushTx(s, `setRevoked ${topic}`);
  save(wallet, s);
  return delay(project(wallet, s));
}

export async function reinstateClaim(wallet: string, topic: Topic): Promise<PassportState> {
  const s = load(wallet);
  s.revoked[topic] = false;
  pushTx(s, `setRevoked ${topic} = false`);
  save(wallet, s);
  return delay(project(wallet, s));
}

/** Link an x402 agent: creates its wallet, links it (Model A) and issues its ENS subname. */
export async function linkAgent(wallet: string, label?: string): Promise<PassportState> {
  const s = load(wallet);
  if (!s.identity) throw new Error('create your identity first');
  const lbl = (label || AGENT_LABELS[s.agents.length % AGENT_LABELS.length]).toLowerCase();
  const agent: Agent = {
    wallet: fakeAddress(),
    label: lbl,
    subname: `${lbl}.${ENS_PARENT}`,
    score: 60 + Math.floor(Math.random() * 40), // demo score 60-99
    verified: true,
    eligibleDealRoom: computeDealRoom(s).ok,
  };
  s.agents = [...s.agents, agent];
  pushTx(s, `linkAgent + issueSubname ${agent.subname}`);
  save(wallet, s);
  return delay(project(wallet, s));
}

export async function unlinkAgent(wallet: string, agentWallet: string): Promise<PassportState> {
  const s = load(wallet);
  s.agents = s.agents.filter((a) => a.wallet !== agentWallet);
  pushTx(s, `unlinkAgent ${agentWallet.slice(0, 10)}…`);
  save(wallet, s);
  return delay(project(wallet, s));
}

export function resetDemo(wallet: string) {
  if (typeof window !== 'undefined') window.localStorage.removeItem(key(wallet));
}

export const TOPIC_LABELS: Record<Topic, string> = {
  KYC_VERIFIED: 'KYC / AML',
  PROOF_OF_PERSONHOOD: 'World ID · Personhood',
  ACCREDITED_INVESTOR: 'Accredited Investor',
};
