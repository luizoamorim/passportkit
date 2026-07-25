/**
 * Identity + claims — the one decision core both demos sit on.
 *
 * Model B throughout: the ClaimIssuer only SIGNS (EIP-712, off-chain, no gas) and
 * the HOLDER submits the signed claim from their own wallet. Nobody writes to
 * somebody else's identity. Revocation is the issuer's LATCH on the ClaimIssuer —
 * flip it and every surface refuses on the very next call, with no re-submission
 * possible while it is closed.
 *
 * SERVER ONLY — it signs with the demo actor keys held in chain.ts.
 */
import { decodeAbiParameters, encodeAbiParameters, keccak256, toHex, type Address, type Hex } from 'viem';

import { CLAIM_DATA_ABI, FACTORY_ABI, GATE_ABI, IDENTITY_ABI, ISSUER_ABI } from './abis';
import {
  ZERO_ADDRESS,
  actorAddress,
  addresses,
  chainNow,
  issuerSigner,
  pools,
  publicClient,
  write,
  type DemoActor,
} from './chain';

/// ERC-735 topics: uint256(keccak256(name)) — the same numbers as libraries/Types.sol.
export const CLAIM_TOPICS = {
  kyc: BigInt(keccak256(toHex('KYC_VERIFIED'))),
  accredited: BigInt(keccak256(toHex('ACCREDITED_INVESTOR'))),
} as const;

export type ClaimName = keyof typeof CLAIM_TOPICS;

export function isClaimName(name: unknown): name is ClaimName {
  return typeof name === 'string' && name in CLAIM_TOPICS;
}

/// topic number → the human name, for the tx inspector.
export const CLAIM_TOPIC_NAMES: Record<string, string> = {
  [CLAIM_TOPICS.kyc.toString()]: 'KYC_VERIFIED',
  [CLAIM_TOPICS.accredited.toString()]: 'ACCREDITED_INVESTOR',
};

/// ERC-734 key purposes (Types.sol KeyPurpose), for the tx inspector.
export const KEY_PURPOSES: Record<string, string> = { '1': 'MANAGEMENT', '2': 'ACTION', '3': 'CLAIM' };

/// How long a freshly issued demo claim stays valid.
export const CLAIM_TTL_SECONDS = 365 * 24 * 3600;

// ---------------------------------------------------------------- reads

export async function identityOf(wallet: Address): Promise<Address | null> {
  const identity = await publicClient.readContract({
    address: addresses().identityFactory,
    abi: FACTORY_ABI,
    functionName: 'identityOfWallet',
    args: [wallet],
  });
  return identity === ZERO_ADDRESS ? null : identity;
}

export interface ClaimState {
  status: 'UNVERIFIED' | 'VERIFIED' | 'REVOKED' | 'EXPIRED';
  expiresAt: number | null;
}

/// Status of one topic on an identity: what the ISSUER thinks of the stored claim.
export async function claimState(identity: Address | null, topic: bigint, now: number): Promise<ClaimState> {
  if (!identity) return { status: 'UNVERIFIED', expiresAt: null };
  const [exists, , data] = await publicClient.readContract({
    address: identity,
    abi: IDENTITY_ABI,
    functionName: 'getClaim',
    args: [topic, addresses().claimIssuer],
  });
  if (!exists) return { status: 'UNVERIFIED', expiresAt: null };

  const [, expiresAt] = decodeAbiParameters(CLAIM_DATA_ABI, data);
  const revoked = await isRevoked(identity, topic);
  const expired = expiresAt !== 0n && now > Number(expiresAt);
  return {
    status: revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'VERIFIED',
    expiresAt: expiresAt === 0n ? null : Number(expiresAt),
  };
}

export function isRevoked(identity: Address, topic: bigint): Promise<boolean> {
  return publicClient.readContract({
    address: addresses().claimIssuer,
    abi: ISSUER_ABI,
    functionName: 'revoked',
    args: [identity, topic],
  });
}

/// The same read every surface makes on-chain: wallet → identity → gate. A wallet
/// with no identity is never eligible, so the UI agrees with the contracts.
export async function isCompliant(wallet: Address, policyId: bigint = pools().house.policyId): Promise<boolean> {
  const identity = await identityOf(wallet);
  if (!identity) return false;
  const [ok] = await publicClient.readContract({
    address: addresses().eligibilityGate,
    abi: GATE_ABI,
    functionName: 'isEligible',
    args: [identity, policyId],
  });
  return ok;
}

// ---------------------------------------------------------------- writes

/// The issuer's latch. Only the issuer can open it again — that is the point.
export function setRevoked(identity: Address, topic: bigint, value: boolean): Promise<Hex> {
  return write('operator', addresses().claimIssuer, ISSUER_ABI, 'setRevoked', [identity, topic, value]);
}

/// Mints the actor's Identity if they have none. Returns it plus the tx it took.
export async function ensureIdentity(actor: DemoActor): Promise<{ identity: Address; txHashes: Hex[] }> {
  const wallet = actorAddress(actor);
  const existing = await identityOf(wallet);
  if (existing) return { identity: existing, txHashes: [] };

  const hash = await write('operator', addresses().identityFactory, FACTORY_ABI, 'createIdentity', [wallet]);
  const identity = await identityOf(wallet);
  if (!identity) throw new Error(`identity creation failed for ${actor}`);
  // identities minted live are not in demo-addresses.json — record them so the
  // tx inspector keeps labelling them "Identity (rui)" instead of a bare address
  addresses().identities[actor] = identity;
  return { identity, txHashes: [hash] };
}

// Only used to keep two claims signed in the same millisecond apart.
let nonceCounter = 0;

/// The issuer signs OFF-CHAIN (EIP-712, no gas). Both keys are local demo keys, so
/// the demo plays both sides: operator = issuer signer, the actor = holder.
async function signClaim(identity: Address, topic: bigint, expiresAt: bigint) {
  const dataHash = keccak256(toHex(`demo-attest-${Date.now()}-${nonceCounter++}`));
  const nonce = keccak256(toHex(`demo-session-${Date.now()}-${nonceCounter++}`));
  const signature = await issuerSigner().signTypedData({
    domain: {
      name: 'PassportKitClaim',
      version: '1',
      chainId: addresses().chainId,
      verifyingContract: addresses().claimIssuer,
    },
    types: {
      Claim: [
        { name: 'identity', type: 'address' },
        { name: 'topic', type: 'uint256' },
        { name: 'dataHash', type: 'bytes32' },
        { name: 'expiresAt', type: 'uint64' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'Claim',
    message: { identity, topic, dataHash, expiresAt, nonce },
  });
  return { signature, data: encodeAbiParameters(CLAIM_DATA_ABI, [dataHash, expiresAt, nonce]) };
}

/// Model B in one call: issuer signs, holder submits from their own wallet.
export async function submitClaim(actor: DemoActor, identity: Address, topic: bigint): Promise<Hex> {
  const expiresAt = BigInt((await chainNow()) + CLAIM_TTL_SECONDS);
  const { signature, data } = await signClaim(identity, topic, expiresAt);
  return write(actor, identity, IDENTITY_ABI, 'submitClaim', [topic, addresses().claimIssuer, signature, data]);
}
