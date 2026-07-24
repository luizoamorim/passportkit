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
import { foundry } from 'viem/chains';

import { decodeNotCompliant } from './lib/decode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts');
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const PORT = Number(process.env.PORT ?? 4180);
const ADDRESSES_FILE = path.join(__dirname, 'addresses.json');

// anvil dev keys — local demo only
const KEYS = {
  operator: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  ana: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  rui: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
};

const CLAIM_TYPES = {
  kyc: keccak256(toHex('KYC_AML_VERIFIED')),
  accredited: keccak256(toHex('ACCREDITED_INVESTOR')),
};
const CLAIM_STATUS = ['UNVERIFIED', 'VERIFIED', 'FAILED', 'EXPIRED', 'REVOKED'];
const PASSPORT_STATUS = ['NONE', 'IN_PROGRESS', 'LIMITED', 'GREEN', 'RED', 'REVOKED', 'EXPIRED'];

const MIN_SQRT_PRICE_PLUS_1 = 4295128740n;
const MAX_SQRT_PRICE_MINUS_1 = 1461446703485210103287273052203988822378723970341n;

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

const LIQUIDITY_ROUTER_ABI = [
  {
    type: 'function',
    name: 'modifyLiquidity',
    stateMutability: 'payable',
    inputs: [
      { ...POOL_KEY_ABI, name: 'key' },
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'liquidityDelta', type: 'int256' },
          { name: 'salt', type: 'bytes32' },
        ],
      },
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

// ---------------------------------------------------------------- world boot

async function rpcCall(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(2000),
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
    { cwd: CONTRACTS_DIR, encoding: 'utf8' },
  );
  if (out.status !== 0) throw new Error(`deploy failed:\n${out.stdout}\n${out.stderr}`);
}

let A; // addresses.json content
let publicClient;
let wallets;
let actorAddress;
let pools;

function loadWorld() {
  A = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
  publicClient = createPublicClient({ chain: foundry, transport: httpTransport(RPC_URL) });
  wallets = Object.fromEntries(
    Object.entries(KEYS).map(([name, pk]) => [
      name,
      createWalletClient({ account: privateKeyToAccount(pk), chain: foundry, transport: httpTransport(RPC_URL) }),
    ]),
  );
  actorAddress = Object.fromEntries(Object.entries(wallets).map(([n, w]) => [n, w.account.address]));
  const base = { currency0: A.token0, currency1: A.token1, fee: A.fee, tickSpacing: A.tickSpacing };
  pools = {
    deal: { key: { ...base, hooks: A.dealHook }, hook: A.dealHook, label: 'Deal Room pool' },
    investor: { key: { ...base, hooks: A.investorHook }, hook: A.investorHook, label: 'Investor pool' },
  };
}

async function ensureWorld() {
  if (!(await rpcUp())) {
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
  if (needDeploy) deployWorld();
  loadWorld();
}

await ensureWorld();
console.log(`[hook-demo] world ready — deal hook ${A.dealHook}`);

// ---------------------------------------------------------------- chain ops

let verificationCounter = 0;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function chainNow() {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
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

async function claimState(wallet, claimType) {
  const c = await publicClient.readContract({
    address: A.claimRegistry,
    abi: REGISTRY_ABI,
    functionName: 'getClaim',
    args: [wallet, claimType],
  });
  const valid = await publicClient.readContract({
    address: A.claimRegistry,
    abi: REGISTRY_ABI,
    functionName: 'hasValidClaim',
    args: [wallet, claimType],
  });
  const now = await chainNow();
  const expired = c.expiresAt !== 0n && now > Number(c.expiresAt) && CLAIM_STATUS[c.status] === 'VERIFIED';
  return {
    status: expired ? 'EXPIRED' : CLAIM_STATUS[c.status],
    valid,
    expiresAt: c.expiresAt === 0n ? null : Number(c.expiresAt),
  };
}

async function actorState(name) {
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
  return {
    name,
    wallet,
    passport: { status: PASSPORT_STATUS[statusIdx], tokenId: Number(tokenId) },
    claims: {
      kyc: await claimState(wallet, CLAIM_TYPES.kyc),
      accredited: await claimState(wallet, CLAIM_TYPES.accredited),
    },
    access: {
      deal: { allowed: dealOk, reason: b32ToString(dealReason) || null },
      investor: { allowed: investorOk, reason: b32ToString(investorReason) || null },
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
  const after = await balancesOf(wallet);
  const delta = Object.fromEntries(
    Object.keys(after).map((sym) => [sym, (Number(after[sym]) - Number(before[sym])).toFixed(2)]),
  );
  return { ok: true, txHash, delta };
}

async function doLiquidity(actor, poolName, direction) {
  const pool = pools[poolName];
  const wallet = actorAddress[actor];
  const delta = direction === 'remove' ? -2_000000000000000000n : 2_000000000000000000n;
  const txHash = await write(actor, A.liquidityRouter, LIQUIDITY_ROUTER_ABI, 'modifyLiquidity', [
    pool.key,
    { tickLower: -887220, tickUpper: 887220, liquidityDelta: delta, salt: pad(wallet, { size: 32 }) },
    encodeAbiParameters([{ type: 'address' }], [wallet]),
  ]);
  return { ok: true, txHash };
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
  await rpcCall('evm_increaseTime', [days * 24 * 3600]);
  await rpcCall('evm_mine', []);
  return { ok: true, warpedDays: days };
}

async function doReset() {
  deployWorld();
  loadWorld();
  return { ok: true };
}

// ---------------------------------------------------------------- http

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
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
      const actors = await Promise.all(Object.keys(KEYS).map(actorState));
      json(res, 200, {
        actors,
        now: await chainNow(),
        contracts: {
          claimRegistry: A.claimRegistry,
          compliancePassport: A.compliancePassport,
          accessGate: A.accessGate,
          poolManager: A.poolManager,
          dealHook: A.dealHook,
          investorHook: A.investorHook,
        },
        pool: { token0: A.token0Symbol, token1: A.token1Symbol, fee: A.fee },
      });
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
