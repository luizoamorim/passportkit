/**
 * ABIs the demo runtime reads and writes — lifted verbatim from
 * apps/hook-demo/server.js and apps/concierge/server.js so the routes agree with
 * the standalone demos call for call.
 */

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
