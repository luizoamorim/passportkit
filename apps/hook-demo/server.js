import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createPublicClient,
  createWalletClient,
  http as httpTransport,
  encodeAbiParameters,
  formatEther,
  keccak256,
  toHex,
  pad,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';

import { decodeNotCompliant } from './lib/decode.js';
import { parseEnvFile } from './lib/env.js';
import {
  MODIFY_LIQUIDITY_TOPIC,
  SWAP_TOPIC,
  MODIFY_LIQUIDITY_EVENT,
  SWAP_EVENT,
  aggregateLiquidity,
  lastPrices,
  poolIdOf,
} from './lib/positions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts');

// ---------------------------------------------------------------- config

const ENV = {
  ...(existsSync(path.join(__dirname, '.env')) ? parseEnvFile(readFileSync(path.join(__dirname, '.env'), 'utf8')) : {}),
  ...process.env,
};
const RPC_URL = ENV.RPC_URL ?? 'http://127.0.0.1:8545';
const PORT = Number(ENV.PORT ?? 4180);
const EXPLORER_URL = (ENV.EXPLORER_URL ?? '').replace(/\/$/, '') || null;
const ADDRESSES_FILE = path.join(__dirname, ENV.ADDRESSES_FILE ?? 'addresses.json');

// anvil dev keys as defaults — override in .env for testnets
const KEYS = {
  operator: ENV.OPERATOR_PK ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ana: ENV.ANA_PK ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  rui: ENV.RUI_PK ?? '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
};

const CLAIM_TYPES = {
  kyc: keccak256(toHex('KYC_AML_VERIFIED')),
  accredited: keccak256(toHex('ACCREDITED_INVESTOR')),
};
const CLAIM_TYPE_NAMES = {
  [CLAIM_TYPES.kyc]: 'KYC_AML_VERIFIED',
  [CLAIM_TYPES.accredited]: 'ACCREDITED_INVESTOR',
};
const CLAIM_STATUS = ['UNVERIFIED', 'VERIFIED', 'FAILED', 'EXPIRED', 'REVOKED'];
const PASSPORT_STATUS = ['NONE', 'IN_PROGRESS', 'LIMITED', 'GREEN', 'RED', 'REVOKED', 'EXPIRED'];

const MIN_SQRT_PRICE_PLUS_1 = 4295128740n;
const MAX_SQRT_PRICE_MINUS_1 = 1461446703485210103287273052203988822378723970341n;
const LIQUIDITY_STEP = 2_000000000000000000n;

// canonical CREATE2 deployer (hook address mining) — anvil ships it at genesis
// but anvil_reset drops it, so reset re-etches it
const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const CREATE2_DEPLOYER_CODE =
  '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';

const POOL_KEY_ABI = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
};

const SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'payable',
    inputs: [
      { ...POOL_KEY_ABI, name: 'key' },
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountSpecified', type: 'int256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
      {
        type: 'tuple',
        name: 'testSettings',
        components: [
          { name: 'takeClaims', type: 'bool' },
          { name: 'settleUsingBurn', type: 'bool' },
        ],
      },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ type: 'int256' }],
  },
];

// DemoPositionRouter — positions are keyed by msg.sender, no salt parameter
const LIQUIDITY_ROUTER_ABI = [
  {
    type: 'function',
    name: 'modifyLiquidity',
    stateMutability: 'payable',
    inputs: [
      { ...POOL_KEY_ABI, name: 'key' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidityDelta', type: 'int256' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ type: 'int256' }],
  },
];

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'submitClaim',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'address' },
      { type: 'bytes32' },
      { type: 'bool' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeClaim',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getClaim',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'approved', type: 'bool' },
          { name: 'issuer', type: 'address' },
          { name: 'attestationHash', type: 'bytes32' },
          { name: 'verificationIdHash', type: 'bytes32' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'updatedAt', type: 'uint64' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'hasValidClaim',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
];

const PASSPORT_ABI = [
  { type: 'function', name: 'syncPassport', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }, { type: 'uint8' }] },
  { type: 'function', name: 'revokePassport', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [] },
  { type: 'function', name: 'statusOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'tokenIdOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const GATE_ABI = [
  { type: 'function', name: 'canAccessDealRoom', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'canAccessInvestorArea', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
];

const HOOK_ABI = [
  { type: 'function', name: 'reasonFor', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bytes32' }] },
];

const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
];

// events the tx inspector can decode
const INSPECTOR_EVENTS = [
  {
    type: 'event',
    name: 'ClaimUpdated',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'claimType', type: 'bytes32', indexed: true },
      { name: 'status', type: 'uint8', indexed: false },
      { name: 'approved', type: 'bool', indexed: false },
      { name: 'verificationIdHash', type: 'bytes32', indexed: true },
      { name: 'attestationHash', type: 'bytes32', indexed: false },
      { name: 'expiresAt', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ClaimRevoked',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'claimType', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'PassportMinted',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'status', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PassportStatusUpdated',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'status', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PassportRevoked',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
  { type: 'event', name: 'Locked', inputs: [{ name: 'tokenId', type: 'uint256', indexed: false }] },
  MODIFY_LIQUIDITY_EVENT,
  SWAP_EVENT,
  {
    type: 'event',
    name: 'Initialize',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'currency0', type: 'address', indexed: true },
      { name: 'currency1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: false },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'hooks', type: 'address', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
];

// ---------------------------------------------------------------- world boot

async function rpcCall(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function rpcUp() {
  try {
    return typeof (await rpcCall('eth_chainId')) === 'string';
  } catch {
    return false;
  }
}

function deployWorld() {
  console.log('[hook-demo] deploying demo world (forge script DeployHookDemo)…');
  const out = spawnSync(
    'forge',
    ['script', 'script/DeployHookDemo.s.sol', '--rpc-url', RPC_URL, '--broadcast'],
    // ENV includes .env-file settings (OPERATOR_PK, POOL_MANAGER, …) that the forge
    // script reads via vm.envOr — process.env alone would silently drop them
    { cwd: CONTRACTS_DIR, encoding: 'utf8', env: ENV },
  );
  if (out.status !== 0) throw new Error(`deploy failed:\n${out.stdout}\n${out.stderr}`);
}

let A;
let LOCAL;
let CHAIN;
let publicClient;
let wallets;
let actorAddress;
let pools;
let logCache;

function loadWorld() {
  A = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
  CHAIN = A.chainId === 31337 ? foundry : A.chainId === sepolia.id ? sepolia : { ...foundry, id: A.chainId };
  publicClient = createPublicClient({ chain: CHAIN, transport: httpTransport(RPC_URL) });
  wallets = Object.fromEntries(
    Object.entries(KEYS).map(([name, pk]) => [
      name,
      createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: httpTransport(RPC_URL) }),
    ]),
  );
  actorAddress = Object.fromEntries(Object.entries(wallets).map(([n, w]) => [n, w.account.address]));
  const base = { currency0: A.token0, currency1: A.token1, fee: A.fee, tickSpacing: A.tickSpacing };
  pools = {
    deal: { key: { ...base, hooks: A.dealHook }, id: poolIdOf({ ...base, hooks: A.dealHook }), hook: A.dealHook },
    investor: { key: { ...base, hooks: A.investorHook }, id: poolIdOf({ ...base, hooks: A.investorHook }), hook: A.investorHook },
  };
  logCache = { nextBlock: BigInt(A.deployBlock ?? 0), logs: [] };
}

async function ensureWorld() {
  const up = await rpcUp();
  const chainIdHex = up ? await rpcCall('eth_chainId') : null;
  LOCAL = !up || chainIdHex === '0x7a69'; // 31337 — or we are about to spawn anvil

  if (!up) {
    if (ENV.RPC_URL && !ENV.RPC_URL.includes('127.0.0.1') && !ENV.RPC_URL.includes('localhost')) {
      throw new Error(`RPC ${RPC_URL} is unreachable`);
    }
    console.log('[hook-demo] starting anvil…');
    const child = spawn('anvil', ['--silent'], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 30 && !(await rpcUp()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await rpcUp())) throw new Error(`anvil did not come up on ${RPC_URL}`);
  }

  let needDeploy = !existsSync(ADDRESSES_FILE);
  if (!needDeploy) {
    const { dealHook } = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
    const probe = createPublicClient({ chain: foundry, transport: httpTransport(RPC_URL) });
    const code = await probe.getCode({ address: dealHook }).catch(() => undefined);
    needDeploy = !code || code === '0x';
  }
  if (needDeploy) {
    if (!LOCAL) {
      throw new Error(
        'demo world not found on this chain — deploy first:\n' +
          '  cd contracts && forge script script/DeployHookDemo.s.sol --rpc-url $RPC_URL --broadcast\n' +
          '(set OPERATOR_PK / ANA_PK / RUI_PK / POOL_MANAGER — see .env.example)',
      );
    }
    await ensureCreate2Deployer();
    deployWorld();
  }
  loadWorld();
}

await ensureWorld();
console.log(`[hook-demo] world ready — chain ${A.chainId}${LOCAL ? ' (local)' : ''} — deal hook ${A.dealHook}`);

// ---------------------------------------------------------------- chain ops

let verificationCounter = 0;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const saltOf = (wallet) => pad(wallet, { size: 32 }).toLowerCase();

async function chainNow() {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

async function refreshLogs() {
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  if (latest >= logCache.nextBlock) {
    const fresh = await publicClient.request({
      method: 'eth_getLogs',
      params: [
        {
          fromBlock: toHex(logCache.nextBlock),
          toBlock: toHex(latest),
          address: A.poolManager,
          topics: [[MODIFY_LIQUIDITY_TOPIC, SWAP_TOPIC]],
        },
      ],
    });
    logCache.logs.push(...fresh);
    logCache.nextBlock = latest + 1n;
  }
  return logCache.logs;
}

async function write(actor, address, abi, functionName, args) {
  const wallet = wallets[actor];
  const { request } = await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account: wallet.account,
  });
  const hash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function balancesOf(wallet) {
  const [t0, t1] = await Promise.all(
    [A.token0, A.token1].map((token) =>
      publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet] }),
    ),
  );
  return {
    [A.token0Symbol]: Number(formatEther(t0)).toFixed(2),
    [A.token1Symbol]: Number(formatEther(t1)).toFixed(2),
  };
}

function deltasBetween(before, after) {
  return Object.fromEntries(
    Object.keys(after).map((sym) => [sym, (Number(after[sym]) - Number(before[sym])).toFixed(2)]),
  );
}

async function claimState(wallet, claimType, now) {
  const c = await publicClient.readContract({
    address: A.claimRegistry,
    abi: REGISTRY_ABI,
    functionName: 'getClaim',
    args: [wallet, claimType],
  });
  const expired = c.expiresAt !== 0n && now > Number(c.expiresAt) && CLAIM_STATUS[c.status] === 'VERIFIED';
  return {
    status: expired ? 'EXPIRED' : CLAIM_STATUS[c.status],
    expiresAt: c.expiresAt === 0n ? null : Number(c.expiresAt),
  };
}

async function actorState(name, now, positions) {
  const wallet = actorAddress[name];
  const [statusIdx, tokenId, dealOk, investorOk, dealReason, investorReason] = await Promise.all([
    publicClient.readContract({ address: A.compliancePassport, abi: PASSPORT_ABI, functionName: 'statusOf', args: [wallet] }),
    publicClient.readContract({ address: A.compliancePassport, abi: PASSPORT_ABI, functionName: 'tokenIdOf', args: [wallet] }),
    publicClient.readContract({ address: A.accessGate, abi: GATE_ABI, functionName: 'canAccessDealRoom', args: [wallet] }),
    publicClient.readContract({ address: A.accessGate, abi: GATE_ABI, functionName: 'canAccessInvestorArea', args: [wallet] }),
    publicClient.readContract({ address: A.dealHook, abi: HOOK_ABI, functionName: 'reasonFor', args: [wallet] }),
    publicClient.readContract({ address: A.investorHook, abi: HOOK_ABI, functionName: 'reasonFor', args: [wallet] }),
  ]);
  const b32ToString = (h) => Buffer.from(h.slice(2), 'hex').toString('utf8').replace(/\0+$/g, '');
  const salt = saltOf(wallet);
  return {
    name,
    wallet,
    passport: { status: PASSPORT_STATUS[statusIdx], tokenId: Number(tokenId) },
    claims: {
      kyc: await claimState(wallet, CLAIM_TYPES.kyc, now),
      accredited: await claimState(wallet, CLAIM_TYPES.accredited, now),
    },
    access: {
      deal: { allowed: dealOk, reason: b32ToString(dealReason) || null },
      investor: { allowed: investorOk, reason: b32ToString(investorReason) || null },
    },
    positions: {
      deal: formatEther(positions.get(`${pools.deal.id}|${salt}`) ?? 0n),
      investor: formatEther(positions.get(`${pools.investor.id}|${salt}`) ?? 0n),
    },
    balances: await balancesOf(wallet),
  };
}

async function doSwap(actor, poolName, zeroForOne) {
  const pool = pools[poolName];
  const wallet = actorAddress[actor];
  const before = await balancesOf(wallet);
  const txHash = await write(actor, A.swapRouter, SWAP_ROUTER_ABI, 'swap', [
    pool.key,
    {
      zeroForOne,
      amountSpecified: -1_000000000000000000n,
      sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_1 : MAX_SQRT_PRICE_MINUS_1,
    },
    { takeClaims: false, settleUsingBurn: false },
    encodeAbiParameters([{ type: 'address' }], [wallet]),
  ]);
  return { ok: true, txHash, delta: deltasBetween(before, await balancesOf(wallet)) };
}

async function doLiquidity(actor, poolName, direction) {
  const pool = pools[poolName];
  const wallet = actorAddress[actor];
  const before = await balancesOf(wallet);
  const delta = direction === 'remove' ? -LIQUIDITY_STEP : LIQUIDITY_STEP;
  const txHash = await write(actor, A.liquidityRouter, LIQUIDITY_ROUTER_ABI, 'modifyLiquidity', [
    pool.key,
    -887220,
    887220,
    delta,
    encodeAbiParameters([{ type: 'address' }], [wallet]),
  ]);
  const { positions } = aggregateLiquidity(await refreshLogs());
  return {
    ok: true,
    txHash,
    delta: deltasBetween(before, await balancesOf(wallet)),
    position: formatEther(positions.get(`${pool.id}|${saltOf(wallet)}`) ?? 0n),
  };
}

async function doVerify(actor, claim, approved) {
  const wallet = actorAddress[actor];
  const expiresAt = BigInt((await chainNow()) + 365 * 24 * 3600);
  const verificationIdHash = keccak256(toHex(`demo-${Date.now()}-${verificationCounter++}`));
  const txHashes = [
    await write('operator', A.claimRegistry, REGISTRY_ABI, 'submitClaim', [
      wallet, CLAIM_TYPES[claim], approved, verificationIdHash, keccak256(toHex('demo-attest')), expiresAt,
    ]),
    await write('operator', A.compliancePassport, PASSPORT_ABI, 'syncPassport', [wallet]),
  ];
  return { ok: true, txHashes };
}

async function doRevokeClaim(actor, claim) {
  const wallet = actorAddress[actor];
  const txHashes = [
    await write('operator', A.claimRegistry, REGISTRY_ABI, 'revokeClaim', [wallet, CLAIM_TYPES[claim]]),
    await write('operator', A.compliancePassport, PASSPORT_ABI, 'syncPassport', [wallet]),
  ];
  return { ok: true, txHashes };
}

async function doRevokePassport(actor) {
  const wallet = actorAddress[actor];
  const txHash = await write('operator', A.compliancePassport, PASSPORT_ABI, 'revokePassport', [wallet]);
  return { ok: true, txHashes: [txHash] };
}

async function doTimewarp(days) {
  if (!LOCAL) return { ok: false, reason: 'LOCAL_ONLY', message: 'timewarp only works on local anvil' };
  await rpcCall('evm_increaseTime', [days * 24 * 3600]);
  await rpcCall('evm_mine', []);
  return { ok: true, warpedDays: days };
}

async function ensureCreate2Deployer() {
  const code = await rpcCall('eth_getCode', [CREATE2_DEPLOYER, 'latest']);
  if (!code || code === '0x') {
    await rpcCall('anvil_setCode', [CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE]);
  }
}

async function doReset() {
  if (!LOCAL) return { ok: false, reason: 'LOCAL_ONLY', message: 'reset only works on local anvil' };
  await rpcCall('anvil_reset', []);
  await ensureCreate2Deployer();
  deployWorld();
  loadWorld();
  return { ok: true };
}

// ---------------------------------------------------------------- tx inspector

function friendlyArg(name, value) {
  if (name === 'claimType' && CLAIM_TYPE_NAMES[value]) return CLAIM_TYPE_NAMES[value];
  if (name === 'status' && typeof value === 'number') return PASSPORT_STATUS[value] ?? CLAIM_STATUS[value] ?? value;
  if (typeof value === 'bigint') {
    if (name === 'expiresAt' || name === 'tokenId' || name === 'fee') return value.toString();
    const abs = value < 0n ? -value : value;
    if (abs >= 10n ** 12n) return `${Number(formatEther(value)).toFixed(4)}e18`;
    return value.toString();
  }
  return String(value);
}

function contractLabel(address) {
  const a = address.toLowerCase();
  const map = {
    [A.claimRegistry.toLowerCase()]: 'ClaimRegistry',
    [A.compliancePassport.toLowerCase()]: 'CompliancePassport',
    [A.accessGate.toLowerCase()]: 'AccessGate',
    [A.poolManager.toLowerCase()]: 'PoolManager',
    [A.swapRouter.toLowerCase()]: 'SwapRouter',
    [A.liquidityRouter.toLowerCase()]: 'LiquidityRouter',
    [A.token0.toLowerCase()]: A.token0Symbol,
    [A.token1.toLowerCase()]: A.token1Symbol,
    [A.dealHook.toLowerCase()]: 'ComplianceHook (deal)',
    [A.investorHook.toLowerCase()]: 'ComplianceHook (investor)',
  };
  return map[a] ?? short(address);
}

// ERC-20 (value in data) and ERC-721 (tokenId indexed) share the Transfer topic;
// try them separately since ABI decoders stop at the first name match
const TRANSFER_VARIANTS = [
  [
    {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'tokenId', type: 'uint256', indexed: true },
      ],
    },
  ],
  [
    {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ],
    },
  ],
];

async function inspectTx(hash) {
  const { decodeEventLog } = await import('viem');
  const [receipt, tx] = await Promise.all([
    publicClient.getTransactionReceipt({ hash }),
    publicClient.getTransaction({ hash }),
  ]);
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const logs = receipt.logs.map((log) => {
    for (const abi of [INSPECTOR_EVENTS, ...TRANSFER_VARIANTS]) {
      try {
        const dec = decodeEventLog({ abi, data: log.data, topics: log.topics });
        return {
          contract: contractLabel(log.address),
          name: dec.eventName,
          args: Object.fromEntries(
            Object.entries(dec.args).map(([k, v]) => [k, friendlyArg(k, v)]),
          ),
        };
      } catch {}
    }
    return { contract: contractLabel(log.address), name: 'unknown', topic: log.topics[0]?.slice(0, 10) };
  });
  return {
    ok: true,
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    timestamp: Number(block.timestamp),
    from: tx.from,
    to: tx.to,
    contract: tx.to ? contractLabel(tx.to) : null,
    gasUsed: receipt.gasUsed.toString(),
    logs,
  };
}

// ---------------------------------------------------------------- http

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function failure(err) {
  const dec = decodeNotCompliant(err);
  if (dec) {
    return { ok: false, reason: dec.reason, wallet: dec.wallet, message: `NotCompliant(${short(dec.wallet)}, ${dec.reason})` };
  }
  return { ok: false, reason: 'ERROR', message: String(err?.shortMessage ?? err?.message ?? err).slice(0, 300) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(path.join(__dirname, 'index.html')));
    } else if (req.method === 'GET' && url.pathname === '/api/state') {
      const now = await chainNow();
      const { positions, totals } = aggregateLiquidity(await refreshLogs());
      const prices = lastPrices(logCache.logs);
      const actors = await Promise.all(Object.keys(KEYS).map((n) => actorState(n, now, positions)));
      json(res, 200, {
        actors,
        now,
        warped: LOCAL && Math.abs(now * 1000 - Date.now()) > 86_400_000,
        local: LOCAL,
        explorer: EXPLORER_URL,
        chainId: A.chainId,
        contracts: {
          claimRegistry: A.claimRegistry,
          compliancePassport: A.compliancePassport,
          accessGate: A.accessGate,
          poolManager: A.poolManager,
          dealHook: A.dealHook,
          investorHook: A.investorHook,
        },
        pool: { token0: A.token0Symbol, token1: A.token1Symbol, fee: A.fee },
        pools: Object.fromEntries(
          Object.entries(pools).map(([name, p]) => [
            name,
            {
              hook: p.hook,
              liquidity: Number(formatEther(totals.get(p.id) ?? 0n)).toFixed(0),
              price: (prices.get(p.id) ?? 1).toFixed(4),
            },
          ]),
        ),
      });
    } else if (req.method === 'GET' && url.pathname.startsWith('/api/tx/')) {
      const hash = url.pathname.slice('/api/tx/'.length);
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return json(res, 400, { ok: false, message: 'bad tx hash' });
      json(res, 200, await inspectTx(hash).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/swap') {
      const { actor, pool = 'deal', zeroForOne = true } = await readBody(req);
      if (!wallets[actor] || !pools[pool]) return json(res, 400, { ok: false, message: 'unknown actor or pool' });
      json(res, 200, await doSwap(actor, pool, Boolean(zeroForOne)).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/liquidity') {
      const { actor, pool = 'deal', direction = 'add' } = await readBody(req);
      if (!wallets[actor] || !pools[pool]) return json(res, 400, { ok: false, message: 'unknown actor or pool' });
      json(res, 200, await doLiquidity(actor, pool, direction).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/verify') {
      const { actor, claim, approved = true } = await readBody(req);
      if (!wallets[actor] || !CLAIM_TYPES[claim]) return json(res, 400, { ok: false, message: 'unknown actor or claim' });
      json(res, 200, await doVerify(actor, claim, Boolean(approved)).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/revoke-claim') {
      const { actor, claim } = await readBody(req);
      if (!wallets[actor] || !CLAIM_TYPES[claim]) return json(res, 400, { ok: false, message: 'unknown actor or claim' });
      json(res, 200, await doRevokeClaim(actor, claim).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/revoke-passport') {
      const { actor } = await readBody(req);
      if (!wallets[actor]) return json(res, 400, { ok: false, message: 'unknown actor' });
      json(res, 200, await doRevokePassport(actor).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/timewarp') {
      const { days = 366 } = await readBody(req);
      json(res, 200, await doTimewarp(Number(days)).catch(failure));
    } else if (req.method === 'POST' && url.pathname === '/api/reset') {
      json(res, 200, await doReset().catch(failure));
    } else {
      json(res, 404, { ok: false, message: 'not found' });
    }
  } catch (err) {
    json(res, 500, failure(err));
  }
});

server.listen(PORT, () => {
  console.log(`[hook-demo] ComplianceHook demo on http://localhost:${PORT}`);
});
