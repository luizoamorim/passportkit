/**
 * Demo runtime — chain plumbing for the one anvil world DeployAll.s.sol writes.
 *
 * SERVER ONLY. This module holds the demo actors' private keys (the well-known
 * anvil dev keys unless overridden in the environment) and touches node:fs and
 * node:child_process. It must never be imported from a client component, and no
 * key may ever be surfaced through a NEXT_PUBLIC_* variable — the browser talks
 * to /api/demo/* and nothing else.
 *
 * Everything here is gated on DEMO_MODE=true: call assertDemo() first in every
 * route handler.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http as httpTransport,
  pad,
  toHex,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';

import { ERC20_ABI } from './abis';
import { decodeRefusal } from './decode.js';
import { MODIFY_LIQUIDITY_TOPIC, SWAP_TOPIC, poolIdOf } from './positions.js';
import { clearTickets } from './tickets';

// ---------------------------------------------------------------- config

export const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
export const EXPLORER_URL = (process.env.EXPLORER_URL ?? '').replace(/\/$/, '') || null;

export const ZERO_ADDRESS = zeroAddress;
export const LOCAL_CHAIN_ID = 31337;

/// anvil dev accounts #0–#4 as defaults — override per actor for testnets.
const KEYS = {
  operator: (process.env.OPERATOR_PK ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
  ana: (process.env.ANA_PK ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d') as Hex,
  rui: (process.env.RUI_PK ?? '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a') as Hex,
  concierge: (process.env.CONCIERGE_PK ?? '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6') as Hex,
  plumber: (process.env.PLUMBER_PK ?? '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a') as Hex,
} as const;

export type DemoActor = keyof typeof KEYS;
export const ACTORS = Object.keys(KEYS) as DemoActor[];
/// the house owners, in the order HouseTreasury holds them
export const OWNERS: DemoActor[] = ['operator', 'ana'];

export function isActor(name: unknown): name is DemoActor {
  return typeof name === 'string' && name in KEYS;
}

// canonical CREATE2 deployer (hook address mining) — anvil ships it at genesis
// but anvil_reset drops it, so reset re-etches it
const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE =
  '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';

// ---------------------------------------------------------------- demo gate

export class DemoDisabledError extends Error {
  constructor() {
    super('demo runtime disabled — set DEMO_MODE=true to enable /api/demo/*');
    this.name = 'DemoDisabledError';
  }
}

export function demoEnabled(): boolean {
  return process.env.DEMO_MODE === 'true';
}

/// Every /api/demo/* handler calls this first; the handler turns the throw into a 403.
export function assertDemo(): void {
  if (!demoEnabled()) throw new DemoDisabledError();
}

// ---------------------------------------------------------------- addresses

export interface DemoAddresses {
  chainId: number;
  deployBlock: number;
  issuerRegistry: Address;
  claimIssuer: Address;
  identityFactory: Address;
  eligibilityGate: Address;
  poolManager: Address;
  swapRouter: Address;
  liquidityRouter: Address;
  token0: Address;
  token0Symbol: string;
  token1: Address;
  token1Symbol: string;
  dealHook: Address;
  investorHook: Address;
  treasury: Address;
  mandateHook: Address;
  casa: Address;
  /// the shared settlement token — the same contract as token0 or token1
  musd: Address;
  fee: number;
  tickSpacing: number;
  policies: { deal: number; investor: number };
  actors: Record<DemoActor, Address>;
  identities: Partial<Record<DemoActor, Address>>;
}

/// Written by contracts/script/DeployAll.s.sol (gitignored). `next dev`/`next start`
/// run with apps/web as the cwd; the repo-root fallback covers `node apps/web/...`.
function addressesPath(): string {
  if (process.env.DEMO_ADDRESSES_FILE) return path.resolve(process.env.DEMO_ADDRESSES_FILE);
  const candidates = [
    path.resolve(process.cwd(), 'demo-addresses.json'),
    path.resolve(process.cwd(), 'apps/web/demo-addresses.json'),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}

/// contracts/ holds DeployAll.s.sol; forge runs there on reset.
function contractsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../contracts'),
    path.resolve(process.cwd(), 'contracts'),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}

// Module state survives HMR by living on globalThis — otherwise every edit in
// `next dev` would drop the in-memory ticket feed and re-scan every pool log.
interface DemoState {
  addresses: DemoAddresses | null;
  pools: Record<PoolName, DemoPool> | null;
  logCache: { nextBlock: bigint; logs: RawLog[] } | null;
  wallets: Partial<Record<DemoActor, WalletClient>>;
}

const globalState = globalThis as unknown as { __passportkitDemo?: DemoState };
const state: DemoState = (globalState.__passportkitDemo ??= {
  addresses: null,
  pools: null,
  logCache: null,
  wallets: {},
});

/// Parsed demo-addresses.json, cached. Throws when the world was never deployed.
export function addresses(): DemoAddresses {
  if (state.addresses) return state.addresses;
  const file = addressesPath();
  if (!existsSync(file)) {
    throw new Error(
      `demo world not found — ${file} is missing. Deploy it first:\n` +
        '  cd contracts && forge script script/DeployAll.s.sol --rpc-url $RPC_URL --broadcast',
    );
  }
  state.addresses = JSON.parse(readFileSync(file, 'utf8')) as DemoAddresses;
  return state.addresses;
}

/// Re-read the file after a redeploy: every address moved, so the pool keys and
/// the pool-log cache are stale too.
export function reloadAddresses(): DemoAddresses {
  state.addresses = null;
  state.pools = null;
  state.logCache = null;
  return addresses();
}

/// The world runs on a chain we may reset and time-warp.
export function isLocal(): boolean {
  return addresses().chainId === LOCAL_CHAIN_ID;
}

// ---------------------------------------------------------------- clients

function chainFor(chainId: number): Chain {
  if (chainId === foundry.id) return foundry;
  if (chainId === sepolia.id) return sepolia;
  return { ...foundry, id: chainId };
}

// The chain id only ever changes when the operator points RPC_URL somewhere
// else, which restarts the process anyway — safe to resolve once at import.
function bootChain(): Chain {
  try {
    return chainFor(addresses().chainId);
  } catch {
    return foundry;
  }
}

/**
 * JSON-RPC batching is what makes this usable on a public chain. One world read fans out ~50
 * concurrent eth_calls; sent individually a hosted RPC rate-limits most of them (measured on
 * Alchemy: 51 of 60 parallel calls -> HTTP 429, surfacing as "HTTP request failed"), while the
 * same 60 packed into a single batched POST return 200 in ~0.2s. Anvil accepts batches too, so
 * this is not testnet-only special-casing.
 */
export const publicClient = createPublicClient({
  chain: bootChain(),
  // A hosted free tier meters COMPUTE UNITS, not requests, so batching alone does not stop a
  // burst from tripping the limit — it just packs it into one 429. Retrying with a backoff is
  // what actually rides it out: the limiter refills continuously, so a retried batch lands.
  transport: httpTransport(RPC_URL, { batch: true, retryCount: 6, retryDelay: 300 }),
});

/// Wallet client for one demo actor. Server-side only — see the file header.
export function walletFor(actor: DemoActor): WalletClient {
  const cached = state.wallets[actor];
  if (cached) return cached;
  const wallet = createWalletClient({
    account: privateKeyToAccount(KEYS[actor]),
    chain: publicClient.chain,
    transport: httpTransport(RPC_URL),
  });
  state.wallets[actor] = wallet;
  return wallet;
}

export function actorAddress(actor: DemoActor): Address {
  return privateKeyToAccount(KEYS[actor]).address;
}

/// The operator key doubles as the ClaimIssuer's authorized EIP-712 signer.
export function issuerSigner(): PrivateKeyAccount {
  return privateKeyToAccount(KEYS.operator);
}

// ---------------------------------------------------------------- raw rpc

export async function rpcCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

export async function chainNow(): Promise<number> {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

// ---------------------------------------------------------------- pools

export type PoolName = 'deal' | 'investor' | 'house';

export interface PoolKeyStruct {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface DemoPool {
  key: PoolKeyStruct;
  id: Hex;
  hook: Address;
  policyId: bigint;
}

/// The three pools of the one world: two ComplianceHook PROP/mUSD pools (one per
/// policy) and the MandateHook CASA/mUSD house pool. Same PoolManager, distinct
/// pool ids because the hooks differ.
export function pools(): Record<PoolName, DemoPool> {
  if (state.pools) return state.pools;
  const A = addresses();
  const base = { currency0: A.token0, currency1: A.token1, fee: A.fee, tickSpacing: A.tickSpacing };
  const casaIsCurrency0 = A.casa.toLowerCase() < A.musd.toLowerCase();
  const houseKey: PoolKeyStruct = {
    currency0: casaIsCurrency0 ? A.casa : A.musd,
    currency1: casaIsCurrency0 ? A.musd : A.casa,
    fee: A.fee,
    tickSpacing: A.tickSpacing,
    hooks: A.mandateHook,
  };
  const dealKey: PoolKeyStruct = { ...base, hooks: A.dealHook };
  const investorKey: PoolKeyStruct = { ...base, hooks: A.investorHook };

  state.pools = {
    deal: { key: dealKey, id: poolIdOf(dealKey), hook: A.dealHook, policyId: BigInt(A.policies.deal) },
    investor: {
      key: investorKey,
      id: poolIdOf(investorKey),
      hook: A.investorHook,
      policyId: BigInt(A.policies.investor),
    },
    // HouseTreasury gates its owners on the Deal Room policy — one decision core.
    house: { key: houseKey, id: poolIdOf(houseKey), hook: A.mandateHook, policyId: BigInt(A.policies.deal) },
  };
  return state.pools;
}

/// CASA sorts below mUSD? — the house swap direction depends on it.
export function casaIsCurrency0(): boolean {
  const A = addresses();
  return A.casa.toLowerCase() < A.musd.toLowerCase();
}

// v4 price bounds (TickMath.{MIN,MAX}_SQRT_PRICE ± 1). A demo swap names no limit
// of its own, so it rides to whichever edge its direction points at.
export const MIN_SQRT_PRICE_PLUS_1 = 4295128740n;
export const MAX_SQRT_PRICE_MINUS_1 = 1461446703485210103287273052203988822378723970341n;

/// The salt a DemoPositionRouter position is keyed by: the owner's wallet, padded.
export const saltOf = (wallet: Address): string => pad(wallet, { size: 32 }).toLowerCase();

// ---------------------------------------------------------------- pool logs

export interface RawLog {
  address: Address;
  data: Hex;
  topics: Hex[];
}

/**
 * How many blocks one eth_getLogs may span. Anvil has no limit, but public Sepolia RPCs do
 * and they disagree: Alchemy's free tier caps the range at 10 blocks, and non-archive nodes
 * refuse a fromBlock older than their retention window entirely. Scanning deployBlock->latest
 * in a single request therefore fails on every free endpoint, so the scan is paged.
 * Raise it with RPC_LOG_CHUNK on an RPC that allows wider ranges — fewer round-trips.
 */
const LOG_CHUNK = BigInt(process.env.RPC_LOG_CHUNK ?? 10);

/**
 * Pages fetched per world read. The backfill from deployBlock can be hundreds of pages after a
 * restart, and firing them all at once exhausts a hosted RPC's rate limit — which then fails the
 * unrelated reads in the same world read, so the whole page 500s. Capping spreads the backfill
 * across successive polls: the demo is usable immediately and the history fills in behind it.
 */
const LOG_PAGES_PER_READ = Number(process.env.RPC_LOG_PAGES ?? 12);

/// Incremental eth_getLogs over the PoolManager's ModifyLiquidity + Swap events —
/// the source for pool liquidity, per-actor positions and last price. Paged (see LOG_CHUNK)
/// and cached, so only blocks produced since the last call are ever fetched.
export async function refreshLogs(): Promise<RawLog[]> {
  const A = addresses();
  const cache = (state.logCache ??= { nextBlock: BigInt(A.deployBlock ?? 0), logs: [] });

  let latest: bigint;
  try {
    latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  } catch {
    return cache.logs; // RPC hiccup: serve what we have rather than failing the whole world read
  }

  for (let page = 0; page < LOG_PAGES_PER_READ && cache.nextBlock <= latest; page++) {
    const to = cache.nextBlock + LOG_CHUNK - 1n < latest ? cache.nextBlock + LOG_CHUNK - 1n : latest;
    try {
      const fresh = await publicClient.request({
        method: 'eth_getLogs',
        params: [
          {
            fromBlock: toHex(cache.nextBlock),
            toBlock: toHex(to),
            address: A.poolManager,
            topics: [[MODIFY_LIQUIDITY_TOPIC, SWAP_TOPIC]],
          },
        ],
      } as never);
      cache.logs.push(...(fresh as unknown as RawLog[]));
      cache.nextBlock = to + 1n; // advance even on an empty page, so we never re-scan
    } catch {
      // A backfill can be hundreds of pages on a public chain, and one flaky page must not
      // fail the whole world read. Keep what we have; nextBlock is unmoved, so the next poll
      // resumes exactly here and the scan converges instead of restarting.
      break;
    }
  }
  return cache.logs;
}

// ---------------------------------------------------------------- token reads

export const readBalance = (token: Address, wallet: Address): Promise<bigint> =>
  publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet] });

/// A wallet's PROP/mUSD row, keyed by symbol — the shape the actor cards render.
export async function balancesOf(wallet: Address): Promise<Record<string, string>> {
  const A = addresses();
  const [t0, t1] = await Promise.all([readBalance(A.token0, wallet), readBalance(A.token1, wallet)]);
  return { [A.token0Symbol]: fixed(t0), [A.token1Symbol]: fixed(t1) };
}

/// after − before, per symbol: what one swap or liquidity move cost the actor.
export function deltasBetween(before: Record<string, string>, after: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.keys(after).map((symbol) => [symbol, (Number(after[symbol]) - Number(before[symbol])).toFixed(2)]),
  );
}

// ---------------------------------------------------------------- writes

/// simulate → send → wait. Returns the tx hash plus the simulated return value
/// (proposePayment's new id, for instance).
export async function send(
  actor: DemoActor,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
): Promise<{ hash: Hex; result: unknown }> {
  const wallet = walletFor(actor);
  const { request, result } = (await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account: wallet.account,
  } as never)) as unknown as { request: unknown; result: unknown };
  const hash = (await wallet.writeContract(request as never)) as Hex;
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, result };
}

export async function write(
  actor: DemoActor,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
): Promise<Hex> {
  const { hash } = await send(actor, address, abi, functionName, args);
  return hash;
}

// ---------------------------------------------------------------- world control

async function ensureCreate2Deployer(): Promise<void> {
  const code = await rpcCall<string>('eth_getCode', [CREATE2_DEPLOYER, 'latest']);
  if (!code || code === '0x') {
    await rpcCall('anvil_setCode', [CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE]);
  }
}

/// Redeploys the whole world with the one script and rewrites demo-addresses.json.
export function deployWorld(): void {
  const out = spawnSync('forge', ['script', 'script/DeployAll.s.sol', '--rpc-url', RPC_URL, '--broadcast'], {
    cwd: contractsDir(),
    encoding: 'utf8',
    env: process.env,
  });
  if (out.status !== 0) throw new Error(`deploy failed:\n${out.stdout}\n${out.stderr}`);
}

export interface WorldOpResult {
  ok: boolean;
  reason?: string;
  message?: string;
  warpedDays?: number;
}

/// anvil_reset wipes the CREATE2 deployer too, so it is re-etched before the
/// hook-mining redeploy. Every address moves, so the ticket feed goes with them.
export async function resetWorld(): Promise<WorldOpResult> {
  if (!isLocal()) return { ok: false, reason: 'LOCAL_ONLY', message: 'reset only works on local anvil' };
  await rpcCall('anvil_reset', []);
  await ensureCreate2Deployer();
  deployWorld();
  reloadAddresses();
  clearTickets();
  return { ok: true };
}

export async function timewarp(days: number): Promise<WorldOpResult> {
  if (!isLocal()) return { ok: false, reason: 'LOCAL_ONLY', message: 'timewarp only works on local anvil' };
  await rpcCall('evm_increaseTime', [days * 24 * 3600]);
  await rpcCall('evm_mine', []);
  return { ok: true, warpedDays: days };
}

/// True once the chain clock has drifted more than a day from wall time.
export function isWarped(now: number): boolean {
  return isLocal() && Math.abs(now * 1000 - Date.now()) > 86_400_000;
}

// ---------------------------------------------------------------- helpers

export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const bytes32ToString = (h: Hex): string =>
  Buffer.from(h.slice(2), 'hex').toString('utf8').replace(/\0+$/g, '');

export const fixed = (wei: bigint, digits = 2): string => Number(formatEther(wei)).toFixed(digits);

export interface Refusal {
  ok: false;
  reason: string;
  wallet: Address | null;
  message: string;
}

/// Turns a thrown viem error into the refusal shape the demo UIs read: a decoded
/// NotAuthorized/NotCompliant when the chain refused, a plain message otherwise.
export function failure(err: unknown): Refusal {
  const dec = decodeRefusal(err);
  if (dec) {
    return { ok: false, reason: dec.reason, wallet: dec.wallet, message: `Refused(${short(dec.wallet)}, ${dec.reason})` };
  }
  // Not a refusal, so it is a genuine fault (RPC down, rate limit, bad address). The client only
  // ever sees a one-line message, which is useless when something breaks mid-demo — log the whole
  // thing server-side so the terminal says which call actually failed.
  console.error('[demo] unexpected failure:', err);
  const e = err as { shortMessage?: string; message?: string };
  return { ok: false, reason: 'ERROR', wallet: null, message: String(e?.shortMessage ?? e?.message ?? err).slice(0, 300) };
}

/// JSON body serializer that survives the bigints viem hands back.
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/// The 403 every /api/demo/* route returns when DEMO_MODE is not 'true'.
export function demoDisabledResponse(): Response {
  return jsonResponse(403, {
    ok: false,
    reason: 'DEMO_DISABLED',
    message: 'demo runtime disabled — set DEMO_MODE=true to enable /api/demo/*',
  });
}
