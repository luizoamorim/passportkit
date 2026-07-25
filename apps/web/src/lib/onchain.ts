'use client';

/**
 * Live reads/writes against the deployed PassportKit contracts on Sepolia — the "show it on screen"
 * path (real on-chain data, not mock). Reads the DEMO wiring done by WireEnsDemo.s.sol:
 *   luiz.casaazul.eth -> compliance.status (GREEN), bot.luiz.casaazul.eth -> agent-registration + reputation.
 * The revoke button is the money moment (ClaimIssuer.setRevoked, from the agent wallet).
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  keccak256,
  namehash,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';

const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

// --- deployed on Sepolia 2026-07-25 (docs/DEPLOYMENTS.md) ---
export const ADDR = {
  resolver: '0x14a83c7aE0667e90ff3863C6eF12539F67e4Cd58' as Address, // DEMO resolver (wired)
  claimIssuer: '0x56F97734cC4d80af950538eAA6976398b5E58Fa9' as Address,
  identity: '0xD2AD5CeB57cef5eDa821978a25c36DB6528D12b4' as Address, // demo person identity
  agent: '0x000000000000000000000000000000000000a6E1' as Address, // demo agent wallet
} as const;

export const PERSON_NAME = 'luiz.casaazul.eth';
export const AGENT_NAME = 'bot.luiz.casaazul.eth';
export const EXPLORER = 'https://sepolia.etherscan.io';

// ClaimTopics.KYC_VERIFIED = uint256(keccak256("KYC_VERIFIED")) — matches the backend/contract.
export const KYC_TOPIC = BigInt(keccak256(toHex('KYC_VERIFIED')));

const RESOLVER_ABI = parseAbi([
  'function text(bytes32 node, string key) view returns (string)',
  'function agentRegistrationKey(address agent) view returns (string)',
  'function agentReputationKey(address agent) view returns (string)',
]);

const CLAIM_ISSUER_ABI = parseAbi([
  'function setRevoked(address identity, uint256 topic, bool value)',
  'function revoked(address identity, uint256 topic) view returns (bool)',
]);

export const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) });

export type LiveState = {
  status: string; // NONE / GREEN / REVOKED
  agentVerified: boolean; // ENSIP-25 "1"
  agentScore: string; // e.g. "87"
  kycRevoked: boolean;
};

export async function readLiveState(): Promise<LiveState> {
  const personNode = namehash(PERSON_NAME);
  const agentNode = namehash(AGENT_NAME);

  const [regKey, repKey, kycRevoked] = await Promise.all([
    publicClient.readContract({ address: ADDR.resolver, abi: RESOLVER_ABI, functionName: 'agentRegistrationKey', args: [ADDR.agent] }),
    publicClient.readContract({ address: ADDR.resolver, abi: RESOLVER_ABI, functionName: 'agentReputationKey', args: [ADDR.agent] }),
    publicClient.readContract({ address: ADDR.claimIssuer, abi: CLAIM_ISSUER_ABI, functionName: 'revoked', args: [ADDR.identity, KYC_TOPIC] }),
  ]);

  const [status, agentReg, agentRep] = await Promise.all([
    publicClient.readContract({ address: ADDR.resolver, abi: RESOLVER_ABI, functionName: 'text', args: [personNode, 'compliance.status'] }),
    publicClient.readContract({ address: ADDR.resolver, abi: RESOLVER_ABI, functionName: 'text', args: [agentNode, regKey as string] }),
    publicClient.readContract({ address: ADDR.resolver, abi: RESOLVER_ABI, functionName: 'text', args: [agentNode, repKey as string] }),
  ]);

  return {
    status: status as string,
    agentVerified: (agentReg as string) === '1',
    agentScore: (agentRep as string) || '0',
    kycRevoked: kycRevoked as boolean,
  };
}

/** Money moment: latch/unlatch the person's KYC. Requires the connected wallet to hold AGENT_ROLE. */
export async function setRevoked(value: boolean): Promise<Hex> {
  const eth = (typeof window !== 'undefined' ? (window as unknown as { ethereum?: unknown }).ethereum : undefined);
  if (!eth) throw new Error('No wallet found — connect the agent wallet (0xEc98…).');
  const [account] = (await (eth as { request: (a: { method: string }) => Promise<Address[]> }).request({
    method: 'eth_requestAccounts',
  }));
  const wallet = createWalletClient({ account, chain: sepolia, transport: custom(eth as never) });
  const hash = await wallet.writeContract({
    address: ADDR.claimIssuer,
    abi: CLAIM_ISSUER_ABI,
    functionName: 'setRevoked',
    args: [ADDR.identity, KYC_TOPIC, value],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
