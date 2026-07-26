'use client';

import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  encodeAbiParameters,
  getAddress,
  hexToString,
  http,
  maxUint256,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { namehash } from 'viem/ens';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { getClaimValid, TOPICS } from './world-chain';

/**
 * Deployed on Sepolia (docs/DEPLOYMENTS.md). Overridable so a redeployed stack is an env
 * change, not a code edit — the API side is already fully env-driven, and these must agree
 * with `PASSPORT_RESOLVER_ADDRESS` / `GATED_ERC20_ADDRESS` in the API's env.
 */
const RESOLVER = (process.env.NEXT_PUBLIC_PASSPORT_RESOLVER_ADDRESS ??
  '0xB31f41e8258fFb3B8Ab0d0c0FB131516A16271ce') as Address;
const GATED_TOKEN = (process.env.NEXT_PUBLIC_GATED_ERC20_ADDRESS ??
  '0xED7c73f2E57aBFF6919eE6bf76F6b0b5361eBb43') as Address;
/**
 * Enforcement surface #4 — the Uniswap v4 pool. The hook holds no eligibility logic of its own:
 * it resolves identityOfWallet(agent) -> the PERSON's identity and asks the SAME EligibilityGate
 * the gated token asks, so one revocation refuses the token AND the pool at once.
 * Policy #1 (KYC only), matching this flow's passport.
 */
const COMPLIANCE_HOOK = (process.env.NEXT_PUBLIC_COMPLIANCE_HOOK_ADDRESS ??
  '0x6C12292FB54B27C2F6DE632276976418af5F4880') as Address;
const SWAP_ROUTER = (process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ??
  '0xb02860dF9D8757Bf4649c067C278e77c62E1D911') as Address;
const MUSDC = (process.env.NEXT_PUBLIC_MUSDC_ADDRESS ??
  '0x268c3BF1AF90f5Bd88B4fbf24fd358617493F3cA') as Address;
const MCASA = (process.env.NEXT_PUBLIC_MCASA_ADDRESS ??
  '0x77Cb80742E424E688A8AE5214000b9af7Ad7C384') as Address;
const RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';

const RESOLVER_ABI = parseAbi([
  'function text(bytes32 node, string key) view returns (string)',
  'function agentRegistrationKey(address agent) view returns (string)',
  'function agentReputationKey(address agent) pure returns (string)',
]);
const GATED_ABI = parseAbi([
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
/** The pool's mock currencies are solmate MockERC20 — `mint` is unrestricted, so the agent funds itself. */
const MOCK_ERC20_ABI = parseAbi([
  'function mint(address to, uint256 value)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);
const HOOK_ABI = parseAbi(['function reasonFor(address wallet) view returns (bytes32)']);
const SWAP_ROUTER_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }',
  'struct TestSettings { bool takeClaims; bool settleUsingBurn; }',
  'function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256)',
]);
/**
 * The two shapes a refusal arrives in. `NotEligible` is GatedERC20 reverting directly;
 * `NotCompliant` is ComplianceHook, which v4 hands back wrapped in `CustomRevert.WrappedError`
 * (the PoolManager re-throws a reverting hook call). Same idea as the anvil demo runtime's
 * `lib/demo/decode.js`, restated here so the two worlds stay uncoupled.
 */
const REFUSAL_ABI = parseAbi([
  'error NotEligible(address wallet, bytes32 reasonCode)',
  'error NotCompliant(address wallet, bytes32 reasonCode)',
  'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)',
]);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

export type PassportStatus = 'NONE' | 'LIMITED' | 'GREEN' | 'REVOKED';

/** The live ENS-resolved compliance status (NONE / GREEN / REVOKED) for a name. */
export async function readComplianceStatus(ensName: string): Promise<string> {
  return (await publicClient.readContract({
    address: RESOLVER,
    abi: RESOLVER_ABI,
    functionName: 'text',
    args: [namehash(ensName), 'compliance.status'],
  })) as string;
}

/**
 * Passport badge status. ENS is the source of truth for REVOKED (the resolver recomputes it live);
 * LIMITED vs GREEN comes from the actual claims (KYC only vs KYC + accredited).
 */
export async function readPassportStatus(identity: Address, ensName: string): Promise<PassportStatus> {
  const [ens, kyc, accredited] = await Promise.all([
    readComplianceStatus(ensName).catch(() => 'NONE'),
    getClaimValid(identity, TOPICS.KYC_VERIFIED).catch(() => false),
    getClaimValid(identity, TOPICS.ACCREDITED_INVESTOR).catch(() => false),
  ]);
  if (ens === 'REVOKED') return 'REVOKED';
  if (kyc && accredited) return 'GREEN';
  if (kyc) return 'LIMITED';
  return 'NONE';
}

/** Live ENSIP-25 agent registration ("1" if linked) + reputation score for an agent name. */
export async function readAgentEns(
  agentEnsName: string,
  agentWallet: Address,
): Promise<{ registration: string; reputation: string }> {
  const node = namehash(agentEnsName);
  const [regKey, repKey] = await Promise.all([
    publicClient.readContract({
      address: RESOLVER,
      abi: RESOLVER_ABI,
      functionName: 'agentRegistrationKey',
      args: [agentWallet],
    }) as Promise<string>,
    publicClient.readContract({
      address: RESOLVER,
      abi: RESOLVER_ABI,
      functionName: 'agentReputationKey',
      args: [agentWallet],
    }) as Promise<string>,
  ]);
  const [registration, reputation] = await Promise.all([
    publicClient.readContract({ address: RESOLVER, abi: RESOLVER_ABI, functionName: 'text', args: [node, regKey] }) as Promise<string>,
    publicClient.readContract({ address: RESOLVER, abi: RESOLVER_ABI, functionName: 'text', args: [node, repKey] }) as Promise<string>,
  ]);
  return { registration, reputation };
}

/** A fresh agent wallet (Model A). The key lives only in this session (React state). */
export function newAgentWallet(): { privateKey: Hex; address: Address } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

export async function gatedBalanceOf(wallet: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: GATED_TOKEN,
    abi: GATED_ABI,
    functionName: 'balanceOf',
    args: [wallet],
  })) as bigint;
}

// ---------------------------------------------------------------- refusals

/** Which enforcement surface said no. Both consume the same EligibilityGate. */
export type Surface = 'token' | 'pool';

/**
 * A surface refused the agent. `code` is the chain's OWN reason code (MISSING_KYC, NO_IDENTITY, …),
 * carried verbatim so the UI never has to invent wording — and never has to render hex.
 */
export class RefusedError extends Error {
  constructor(
    readonly surface: Surface,
    readonly code: string | null,
    readonly wallet: Address | null,
  ) {
    super(code ? `refused: ${code}` : 'refused');
    this.name = 'RefusedError';
  }
}

/** bytes32 ASCII reason code -> text. bytes32(0) means "no refusal", so null. */
function reasonCodeToText(raw: Hex): string | null {
  const text = hexToString(raw).replace(/\0+$/g, '');
  return text === '' ? null : text;
}

/** Walk a thrown viem error for the raw revert payload (it nests the cause chain). */
function revertDataOf(err: unknown): Hex | null {
  let cur = err as Record<string, unknown> | null | undefined;
  for (let depth = 0; cur && depth < 8; depth++) {
    for (const key of ['data', 'raw'] as const) {
      const v = cur[key];
      if (typeof v === 'string' && v.startsWith('0x') && v.length >= 10) return v as Hex;
    }
    cur = cur.cause as Record<string, unknown> | undefined;
  }
  return null;
}

/**
 * Decode a refusal out of raw revert data or a thrown viem error. Unwraps v4's `WrappedError`
 * (recursively — the PoolManager may wrap more than once) and returns the wallet the surface
 * judged plus its reason code. Anything else (out of gas, slippage, …) returns null: not every
 * failure is a compliance decision, and the demo must not claim it was.
 */
export function decodeRefusal(input: unknown): { wallet: Address; code: string | null } | null {
  const data = typeof input === 'string' && input.startsWith('0x') ? (input as Hex) : revertDataOf(input);
  if (!data) return null;
  let decoded;
  try {
    decoded = decodeErrorResult({ abi: REFUSAL_ABI, data });
  } catch {
    return null;
  }
  if (decoded.errorName === 'WrappedError') return decodeRefusal(decoded.args[2] as Hex);
  return {
    wallet: getAddress(decoded.args[0] as Address),
    code: reasonCodeToText(decoded.args[1] as Hex),
  };
}

/** Rethrow a refusal as a typed one; anything else keeps its own error. */
function asRefusal(surface: Surface, err: unknown): never {
  const refusal = decodeRefusal(err);
  if (refusal) throw new RefusedError(surface, refusal.code, refusal.wallet);
  throw err;
}

/** A client signing as the agent's own session key (Model A) — it pays for and owns every action. */
function agentClient(privateKey: Hex) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: sepolia,
    transport: http(RPC_URL),
  });
}
type AgentClient = ReturnType<typeof agentClient>;

/**
 * Confirm a sent transaction, and never call a refusal a success.
 *
 * An RPC that pre-flights `eth_sendRawTransaction` rejects a doomed transaction and viem throws —
 * but one that doesn't (anvil, plenty of public nodes) mines it happily, and viem RESOLVES with a
 * `reverted` receipt. A green check on that receipt is exactly the failed demo we are here to avoid,
 * so a reverted receipt replays the call to recover the revert data the receipt doesn't carry.
 */
async function confirm(surface: Surface, hash: Hex, replay: () => Promise<unknown>): Promise<Hex> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'success') return hash;
  try {
    await replay();
  } catch (e) {
    asRefusal(surface, e);
  }
  throw new RefusedError(surface, null, null); // reverted, but not for a reason we can name
}

// ---------------------------------------------------------------- surface #3: the gated token

/**
 * The agent acts on Casa Azul's compliant liquidity: it transfers the gated token. GatedERC20 resolves
 * identityOfWallet(agent) -> the PERSON's identity -> isEligible. Succeeds while the person is KYC'd;
 * REVERTS (NotEligible) once the person is revoked. Signed by the agent's own session key (Model A).
 */
export async function agentTransfer(params: {
  agentPrivateKey: Hex;
  to: Address;
  amount?: string; // ether units, default 10
}): Promise<Hex> {
  const walletClient = agentClient(params.agentPrivateKey);
  // Simulate against head first: an eth_call surfaces the gate's revert verbatim and instantly,
  // where a sent transaction only does so if the RPC happens to pre-flight it.
  const simulate = () =>
    publicClient.simulateContract({
      account: walletClient.account,
      address: GATED_TOKEN,
      abi: GATED_ABI,
      functionName: 'transfer',
      args: [params.to, parseEther(params.amount ?? '10')],
      gas: BigInt(300_000),
    });
  try {
    const { request } = await simulate();
    return await confirm('token', await walletClient.writeContract(request), simulate);
  } catch (e) {
    asRefusal('token', e);
  }
}

// ---------------------------------------------------------------- surface #4: the v4 pool

/**
 * Casa Azul's compliant pool: mCASA (house scrip) / mUSDC (stablecoin), fee 3000, tickSpacing 60,
 * hooked by ComplianceHook. v4 orders a pool's currencies by address and that ordering is part of
 * the pool's identity, so it is derived rather than assumed — an env override cannot mis-key it.
 */
const [CURRENCY0, CURRENCY1] =
  MUSDC.toLowerCase() < MCASA.toLowerCase() ? [MUSDC, MCASA] : [MCASA, MUSDC];
const POOL_KEY = {
  currency0: CURRENCY0,
  currency1: CURRENCY1,
  fee: 3000,
  tickSpacing: 60,
  hooks: COMPLIANCE_HOOK,
} as const;

/// The agent sells house scrip for stablecoin: mCASA in, mUSDC out.
const ZERO_FOR_ONE = CURRENCY0.toLowerCase() === MCASA.toLowerCase();
/// TickMath bounds, nudged inside by one: a limit AT the bound reverts before the hook ever runs,
/// which would show the demo a price error where the compliance refusal belongs.
const MIN_SQRT_PRICE_PLUS_1 = 4295128739n + 1n;
const MAX_SQRT_PRICE_MINUS_1 = 1461446703485210103287273052203988822378723970342n - 1n;
/// Negative amountSpecified = exact input ("spend exactly this much mCASA").
const SWAP_AMOUNT_IN = parseEther('1');
/// One top-up covers a whole session of swaps, so the agent mints once and never again.
const MCASA_TOP_UP = parseEther('100');
/// A v4 swap through the hook measured ~221k gas on a Sepolia fork; pin a generous ceiling because
/// the agent wallet is fresh and viem's estimate can overshoot the RPC provider's cap.
const SWAP_GAS = BigInt(600_000);

/**
 * v4 passes the ROUTER as the hook's `sender`, so the trading wallet has to be declared in hookData
 * — without it the pool would judge the router's compliance, not the agent's.
 */
const hookDataFor = (wallet: Address) => encodeAbiParameters([{ type: 'address' }], [wallet]);

/**
 * Why the pool would refuse `wallet` right now, straight from the hook's own view — the exact code
 * its revert would carry. null means it would let the wallet trade.
 */
export async function readPoolRefusal(wallet: Address): Promise<string | null> {
  const code = (await publicClient.readContract({
    address: COMPLIANCE_HOOK,
    abi: HOOK_ABI,
    functionName: 'reasonFor',
    args: [wallet],
  })) as Hex;
  return reasonCodeToText(code);
}

/** mCASA the agent holds — the float it trades with. */
export async function agentPoolBalance(wallet: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: MCASA,
    abi: MOCK_ERC20_ABI,
    functionName: 'balanceOf',
    args: [wallet],
  })) as bigint;
}

/**
 * Surface #4: the agent swaps on Casa Azul's compliant Uniswap v4 pool. Same identity, same gate as
 * the token above — ComplianceHook's `beforeSwap` resolves identityOfWallet(agent) -> the PERSON's
 * identity -> isEligible(policy 1). Succeeds while the person is KYC'd; once the person is revoked
 * the PoolManager throws the hook's NotCompliant back wrapped, and this raises a RefusedError.
 *
 * The pool currencies are unrestricted mocks, so the agent mints and approves its own float — the
 * backend only has to drip gas. Both are skipped once done, so the retry after the revoke is a
 * single transaction and the refusal is the only thing that happens.
 */
export async function agentSwap(params: { agentPrivateKey: Hex }): Promise<Hex> {
  const walletClient = agentClient(params.agentPrivateKey);
  const account = walletClient.account;

  // Funding first, but only when the pool would actually let this wallet in: a refused agent must
  // not burn its gas drip on a float it can never trade.
  if (!(await readPoolRefusal(account.address))) {
    await ensureSwapFloat(walletClient, account.address);
  }

  // Simulate against head first: an eth_call surfaces the hook's revert verbatim and instantly,
  // where a sent transaction only does so if the RPC happens to pre-flight it.
  const simulate = () =>
    publicClient.simulateContract({
      account,
      address: SWAP_ROUTER,
      abi: SWAP_ROUTER_ABI,
      functionName: 'swap',
      args: [
        POOL_KEY,
        {
          zeroForOne: ZERO_FOR_ONE,
          amountSpecified: -SWAP_AMOUNT_IN,
          sqrtPriceLimitX96: ZERO_FOR_ONE ? MIN_SQRT_PRICE_PLUS_1 : MAX_SQRT_PRICE_MINUS_1,
        },
        { takeClaims: false, settleUsingBurn: false },
        hookDataFor(account.address),
      ],
      gas: SWAP_GAS,
    });
  try {
    const { request } = await simulate();
    return await confirm('pool', await walletClient.writeContract(request), simulate);
  } catch (e) {
    asRefusal('pool', e);
  }
}

/** Mint the agent its mCASA float and approve the router, each only if it is actually short. */
async function ensureSwapFloat(walletClient: AgentClient, wallet: Address): Promise<void> {
  if ((await agentPoolBalance(wallet)) < SWAP_AMOUNT_IN) {
    const hash = await walletClient.writeContract({
      address: MCASA,
      abi: MOCK_ERC20_ABI,
      functionName: 'mint',
      args: [wallet, MCASA_TOP_UP],
      gas: BigInt(150_000),
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const allowance = (await publicClient.readContract({
    address: MCASA,
    abi: MOCK_ERC20_ABI,
    functionName: 'allowance',
    args: [wallet, SWAP_ROUTER],
  })) as bigint;
  if (allowance < SWAP_AMOUNT_IN) {
    // PoolSwapTest pulls the input token inside its unlock callback, so the router needs the approval.
    const hash = await walletClient.writeContract({
      address: MCASA,
      abi: MOCK_ERC20_ABI,
      functionName: 'approve',
      args: [SWAP_ROUTER, maxUint256],
      gas: BigInt(150_000),
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}
