/**
 * ABIs the demo runtime reads and writes — lifted verbatim from the two
 * standalone demo servers this app replaced, so the routes agree with them
 * call for call.
 */
import type { Abi } from 'viem';

import { MODIFY_LIQUIDITY_EVENT, SWAP_EVENT } from './positions.js';

// Identity claim payload: abi.encode(dataHash, expiresAt, nonce) — a hash, never PII
export const CLAIM_DATA_ABI = [{ type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }] as const;

export const POOL_KEY_ABI = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const;

export const SWAP_ROUTER_ABI = [
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
] as const;

// DemoPositionRouter — positions are keyed by msg.sender, no salt parameter
export const LIQUIDITY_ROUTER_ABI = [
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
] as const;

// Identity (ERC-735) — Model B: the HOLDER submits their own issuer-signed claim
export const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'submitClaim',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256' }, { type: 'address' }, { type: 'bytes' }, { type: 'bytes' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getClaim',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'address' }],
    outputs: [{ type: 'bool' }, { type: 'bytes' }, { type: 'bytes' }],
  },
] as const;

export const FACTORY_ABI = [
  {
    type: 'function',
    name: 'identityOfWallet',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'createIdentity',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'address' }],
  },
] as const;

// ClaimIssuer — signs off-chain (EIP-712) and holds the revocation latch
export const ISSUER_ABI = [
  {
    type: 'function',
    name: 'setRevoked',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revoked',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

export const GATE_ABI = [
  {
    type: 'function',
    name: 'isEligible',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }, { type: 'bytes32' }],
  },
] as const;

export const HOOK_ABI = [
  {
    type: 'function',
    name: 'reasonFor',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'bytes32' }],
  },
] as const;

// PassportResolver (ENS, surface #3) — every record is computed at read time from the
// same gate the pools ask, so there is nothing to write and nothing to cache.
export const RESOLVER_ABI = [
  {
    type: 'function',
    name: 'text',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'string' }],
    outputs: [{ type: 'string' }],
  },
  // ENSIP-25 record keys, derived on-chain from the agent's wallet
  {
    type: 'function',
    name: 'agentRegistrationKey',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'agentReputationKey',
    stateMutability: 'pure',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'string' }],
  },
] as const;

export const TREASURY_ABI = [
  {
    type: 'function',
    name: 'proposePayment',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  { type: 'function', name: 'approvePayment', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'executePayment', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'fundConcierge', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  {
    type: 'function',
    name: 'grantMandate',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint64' }],
    outputs: [],
  },
  { type: 'function', name: 'revokeMandate', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'payments',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'vendor', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'approvals', type: 'uint256' },
      { name: 'executed', type: 'bool' },
    ],
  },
  { type: 'function', name: 'nextPaymentId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'isAgentInGoodStanding',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'bool' }, { type: 'bytes32' }],
  },
  { type: 'function', name: 'agentPerTxCap', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'APPROVAL_THRESHOLD', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

// ---------------------------------------------------------------- tx inspector

// The v4 PoolManager events already live in positions.js (they double as the
// liquidity/price source), so the inspector borrows them instead of restating them.
const V4_POOL_EVENTS = [MODIFY_LIQUIDITY_EVENT, SWAP_EVENT] as unknown as Abi;

/// Every event GET /api/demo/tx/<hash> can name — the union of what the two
/// standalone servers decoded, on the new stack: identity + issuer, the house
/// treasury, and the v4 PoolManager. Transfer is handled separately below.
export const INSPECTOR_EVENTS: Abi = [
  // --- identity + issuer ---
  {
    type: 'event',
    name: 'IdentityCreated',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'identity', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ClaimAdded',
    inputs: [
      { name: 'claimId', type: 'bytes32', indexed: true },
      { name: 'topic', type: 'uint256', indexed: true },
      { name: 'issuer', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ClaimRevoked',
    inputs: [
      { name: 'topic', type: 'uint256', indexed: true },
      { name: 'issuer', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'KeyAdded',
    inputs: [
      { name: 'key', type: 'bytes32', indexed: true },
      { name: 'purpose', type: 'uint256', indexed: true },
    ],
  },
  // the revocation latch — the money moment, in one log line
  {
    type: 'event',
    name: 'RevocationSet',
    inputs: [
      { name: 'identity', type: 'address', indexed: true },
      { name: 'topic', type: 'uint256', indexed: true },
      { name: 'revoked', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TrustedSet',
    inputs: [
      { name: 'issuer', type: 'address', indexed: true },
      { name: 'topic', type: 'uint256', indexed: true },
      { name: 'ok', type: 'bool', indexed: false },
    ],
  },
  // --- HouseTreasury ---
  {
    type: 'event',
    name: 'MandateGranted',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'perTxCap', type: 'uint256', indexed: false },
      { name: 'expiresAt', type: 'uint64', indexed: false },
    ],
  },
  { type: 'event', name: 'MandateRevoked', inputs: [{ name: 'agent', type: 'address', indexed: true }] },
  {
    type: 'event',
    name: 'ConciergeFunded',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentProposed',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'vendor', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'evidenceHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentApproved',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'approvals', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentExecuted',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'vendor', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  // --- v4 PoolManager ---
  ...V4_POOL_EVENTS,
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

/// ERC-20 (value in data) and ERC-721 (tokenId indexed) share the Transfer topic,
/// so they cannot sit in one ABI: a decoder stops at the first name match. Tried
/// in order — the topic count tells them apart.
export const TRANSFER_EVENT_VARIANTS: Abi[] = [
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
