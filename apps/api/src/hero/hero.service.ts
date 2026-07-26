import { Injectable, Logger } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { namehash } from 'viem/ens';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { anvil, sepolia, arbitrumSepolia } from 'viem/chains';
import { IdentityService } from '../identity/identity.service';

const RESOLVER_ABI = parseAbi([
  'function setIdentity(bytes32 node, bytes32 parentNode, address identity)',
]);
const FACTORY_ABI = parseAbi([
  'function linkAgent(address agentWallet, address personIdentity)',
  'function identityOfWallet(address) view returns (address)',
]);
const SCORE_ABI = parseAbi(['function setScore(address agent, uint256 score)']);
const GATED_ABI = parseAbi(['function mint(address to, uint256 amt)']);

// EIP-7702 delegated agent wallet: pin an explicit gas so viem doesn't overshoot the RPC cap.
const WRITE_GAS = BigInt(1_000_000);
// Gas drip so a fresh Privy / agent wallet can send its own txs, and the token float the agent trades.
const DRIP_WEI = parseEther('0.005');
const DRIP_MIN_WEI = parseEther('0.003'); // skip the drip if the wallet already has this much
const AGENT_TOKEN_MINT = parseEther('1000');

function resolveChain(chainId: number): Chain {
  if (chainId === 31337) return anvil;
  if (chainId === 11155111) return sepolia;
  if (chainId === 421614) return arbitrumSepolia;
  return { ...anvil, id: chainId };
}

export interface ProvisionResult {
  identity: Address;
  wallet: Address;
  ensName: string;
  created: boolean;
  txs: Record<string, Hex | null>;
}

export interface LinkAgentResult {
  agentWallet: Address;
  personIdentity: Address;
  agentEnsName: string;
  score: number;
  txs: Record<string, Hex | null>;
}

/**
 * HeroService — the guided Sepolia demo's on-chain provisioning (agent key = AGENT_PRIVATE_KEY, 0xEc98).
 *
 * It does the writes the USER can't do for themselves: create the Identity, bind a LIVE ENS subname on
 * our PassportResolver (controller = agent), link an agent wallet (Model A), set its reputation, and
 * drip gas + mint Casa Azul tokens so fresh Privy/agent wallets are self-sufficient (no faucet). The
 * user still submits their OWN claims (Model B) — this only provisions containers + ENS + funding.
 *
 * Writes are sequential (await each receipt) with an explicit gas limit: the agent wallet is EIP-7702
 * delegated, where viem's estimate overshoots the provider cap and parallel sends hit the in-flight limit.
 */
@Injectable()
export class HeroService {
  private readonly logger = new Logger(HeroService.name);
  private readonly account?: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly rpcUrl: string;
  private readonly parentName: string;
  private readonly parentNode: Hex;
  private readonly resolver: Address;
  private readonly factory: Address;
  private readonly scoreRegistry: Address;
  private readonly gatedToken: Address;

  private readonly publicClient;
  private readonly walletClient?;

  constructor(private readonly identity: IdentityService) {
    this.rpcUrl = process.env.RPC_URL ?? 'http://localhost:8545';
    const chainId = parseInt(process.env.CHAIN_ID ?? '11155111', 10);
    this.chain = resolveChain(chainId);
    this.parentName = process.env.ENS_PARENT_NAME ?? 'casaazul.eth';
    this.parentNode = namehash(this.parentName);
    this.resolver = (process.env.PASSPORT_RESOLVER_ADDRESS ?? '0x') as Address;
    this.factory = (process.env.IDENTITY_FACTORY_ADDRESS ?? '0x') as Address;
    this.scoreRegistry = (process.env.SCORE_REGISTRY_ADDRESS ?? '0x') as Address;
    this.gatedToken = (process.env.GATED_ERC20_ADDRESS ?? '0x') as Address;

    this.publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl) });
    const pk = (process.env.AGENT_PRIVATE_KEY ?? '') as Hex;
    if (pk && pk !== '0x') {
      this.account = privateKeyToAccount(pk);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: this.chain,
        transport: http(this.rpcUrl),
      });
      this.logger.log(`Hero provisioning ready: ${this.account.address} parent=${this.parentName}`);
    } else {
      this.logger.warn('AGENT_PRIVATE_KEY not set — hero provisioning disabled until configured');
    }
  }

  /** Step 2: create the identity, drip gas to the user, bind <label>.casaazul.eth -> identity (live ENS). */
  async provisionUser(params: { wallet: Address; label: string }): Promise<ProvisionResult> {
    this.assertReady();
    const { wallet } = params;
    const label = this.normalizeLabel(params.label);

    const created = await this.identity.createIdentity(wallet);
    const dripTx = await this.gasDrip(wallet);
    const ensName = `${label}.${this.parentName}`;
    const bindTx = await this.bindSubname(ensName, created.identity);

    return {
      identity: created.identity,
      wallet,
      ensName,
      created: created.created,
      txs: { createIdentity: created.transactionHash, gasDrip: dripTx, bindEns: bindTx },
    };
  }

  /** Step 5: link an agent wallet to the person (Model A), bind bot.<label>, set reputation, fund it. */
  async linkAgent(params: {
    agentWallet: Address;
    personIdentity: Address;
    label: string;
    score?: number;
  }): Promise<LinkAgentResult> {
    this.assertReady();
    const { agentWallet, personIdentity } = params;
    const label = this.normalizeLabel(params.label);
    const score = params.score ?? 87;

    let linkTx: Hex | null = null;
    const already = (await this.publicClient.readContract({
      address: this.factory,
      abi: FACTORY_ABI,
      functionName: 'identityOfWallet',
      args: [agentWallet],
    })) as Address;
    if (already === zeroAddress) {
      linkTx = await this.write(this.factory, FACTORY_ABI, 'linkAgent', [agentWallet, personIdentity]);
    }

    const agentEnsName = `bot.${label}.${this.parentName}`;
    const bindTx = await this.bindSubname(agentEnsName, personIdentity);
    const scoreTx = await this.write(this.scoreRegistry, SCORE_ABI, 'setScore', [
      agentWallet,
      BigInt(score),
    ]);
    const dripTx = await this.gasDrip(agentWallet);
    const mintTx = await this.write(this.gatedToken, GATED_ABI, 'mint', [agentWallet, AGENT_TOKEN_MINT]);

    return {
      agentWallet,
      personIdentity,
      agentEnsName,
      score,
      txs: { linkAgent: linkTx, bindEns: bindTx, setScore: scoreTx, gasDrip: dripTx, mintTokens: mintTx },
    };
  }

  /** Bind an ENS node under the tenant to an identity on our PassportResolver (controller = agent). */
  private async bindSubname(fullName: string, identity: Address): Promise<Hex> {
    return this.write(this.resolver, RESOLVER_ABI, 'setIdentity', [
      namehash(fullName),
      this.parentNode,
      identity,
    ]);
  }

  /** Top up a wallet so it can pay for its own txs. Skips if it already has enough. */
  private async gasDrip(to: Address): Promise<Hex | null> {
    if (!this.walletClient) throw new Error('AGENT_PRIVATE_KEY not configured');
    const balance = await this.publicClient.getBalance({ address: to });
    if (balance >= DRIP_MIN_WEI) {
      this.logger.log(`gasDrip skipped for ${to} (balance ok)`);
      return null;
    }
    const hash = await this.sendWithRetry(
      () => this.walletClient!.sendTransaction({ to, value: DRIP_WEI }),
      `gasDrip ${to}`,
    );
    return hash;
  }

  private async write(
    address: Address,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[],
  ): Promise<Hex> {
    if (!this.walletClient) throw new Error('AGENT_PRIVATE_KEY not configured');
    return this.sendWithRetry(
      () =>
        this.walletClient!.writeContract({
          address,
          abi: abi as never,
          functionName: functionName as never,
          args: args as never,
          gas: WRITE_GAS,
        }),
      `${functionName} -> ${address}`,
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send a tx, wait for its receipt, then pause before the caller sends the next one. The agent wallet
   * is EIP-7702 delegated: the RPC allows only ONE in-flight tx per delegated account, so back-to-back
   * sends throw "in-flight transaction limit reached for delegated accounts". We serialize (this is the
   * `--slow` behaviour foundry needs) and retry that specific error with backoff so a fresh receipt has
   * time to clear before the next send.
   */
  private async sendWithRetry(send: () => Promise<Hex>, label: string): Promise<Hex> {
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const hash = await send();
        await this.publicClient.waitForTransactionReceipt({ hash });
        await this.delay(2000); // let the delegated account clear before the next tx
        this.logger.log(`${label} txHash=${hash}`);
        return hash;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const retryable = /in-flight|delegated|nonce|replacement transaction underpriced/i.test(msg);
        if (retryable && attempt < maxAttempts) {
          this.logger.warn(`${label} retry ${attempt}/${maxAttempts}: ${msg.slice(0, 90)}`);
          await this.delay(4000);
          continue;
        }
        throw e;
      }
    }
    throw new Error(`${label} failed after ${maxAttempts} attempts`);
  }

  private normalizeLabel(label: string): string {
    const l = (label ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!l) throw new Error('invalid ENS label');
    return l;
  }

  private assertReady(): void {
    for (const [k, v] of [
      ['PASSPORT_RESOLVER_ADDRESS', this.resolver],
      ['IDENTITY_FACTORY_ADDRESS', this.factory],
      ['SCORE_REGISTRY_ADDRESS', this.scoreRegistry],
      ['GATED_ERC20_ADDRESS', this.gatedToken],
    ] as const) {
      if (v === ('0x' as Address) || v === zeroAddress) throw new Error(`${k} not configured`);
    }
    if (!this.account || !this.walletClient) throw new Error('AGENT_PRIVATE_KEY not configured');
  }
}
