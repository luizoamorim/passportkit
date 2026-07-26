# Deployments

## Ethereum Sepolia — THE STACK (redeployed 2026-07-26, chainId 11155111)

Deployed from scratch so **one key owns every role**: admin, agent, issuer signer, minter, scorer
and ENS tenant controller are all
`0x8368c1EAEad096124665E80D68eD0e763c242dC8` (startBlock **11352168**). No dependency on any
other key holder — the backend can create identities, sign claims, link agents, mint, score and
**revoke** on its own. Every contract verified on Etherscan. 13.1M gas across both scripts.

| Contract | Address |
|---|---|
| IssuerRegistry | [`0xCFc0b7Cf6B877d3F80A57123b85ba7D9f4c965e1`](https://sepolia.etherscan.io/address/0xCFc0b7Cf6B877d3F80A57123b85ba7D9f4c965e1) |
| ClaimIssuer | [`0x997FfC7e02f405deF917d28481A4B5Da0b356d29`](https://sepolia.etherscan.io/address/0x997FfC7e02f405deF917d28481A4B5Da0b356d29) |
| EligibilityGate | [`0x44d96CCa9BF17deF6E2BF6D00dbF2Ee5eee06998`](https://sepolia.etherscan.io/address/0x44d96CCa9BF17deF6E2BF6D00dbF2Ee5eee06998) |
| IdentityFactory | [`0x3c8315ed76bc95cD009B96516e6c6d60145f9c96`](https://sepolia.etherscan.io/address/0x3c8315ed76bc95cD009B96516e6c6d60145f9c96) |
| GatedERC20 | [`0xED7c73f2E57aBFF6919eE6bf76F6b0b5361eBb43`](https://sepolia.etherscan.io/address/0xED7c73f2E57aBFF6919eE6bf76F6b0b5361eBb43) |
| ScoreRegistry | [`0x73c51043524a84C375Adb710c40dfF6544E6Ea59`](https://sepolia.etherscan.io/address/0x73c51043524a84C375Adb710c40dfF6544E6Ea59) |
| PassportResolver | [`0xB31f41e8258fFb3B8Ab0d0c0FB131516A16271ce`](https://sepolia.etherscan.io/address/0xB31f41e8258fFb3B8Ab0d0c0FB131516A16271ce) |
| PassportSubnameRegistrar | [`0xFeF9199F4c3CfDE5F11304b4EBc3784542F3481a`](https://sepolia.etherscan.io/address/0xFeF9199F4c3CfDE5F11304b4EBc3784542F3481a) |

**Uniswap v4** — ComplianceHook pools on the canonical PoolManager
`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`, both reading the gate above:

| Contract | Address |
|---|---|
| ComplianceHook — policy #1 Deal Room | [`0x6C12292FB54B27C2F6DE632276976418af5F4880`](https://sepolia.etherscan.io/address/0x6C12292FB54B27C2F6DE632276976418af5F4880) |
| ComplianceHook — policy #2 Investor | [`0x87A2483F1ADD5e3C03C74Dc281675E6B394f8880`](https://sepolia.etherscan.io/address/0x87A2483F1ADD5e3C03C74Dc281675E6B394f8880) |
| mUSDC (token0) | [`0x268c3BF1AF90f5Bd88B4fbf24fd358617493F3cA`](https://sepolia.etherscan.io/address/0x268c3BF1AF90f5Bd88B4fbf24fd358617493F3cA) |
| mCASA (token1) | [`0x77Cb80742E424E688A8AE5214000b9af7Ad7C384`](https://sepolia.etherscan.io/address/0x77Cb80742E424E688A8AE5214000b9af7Ad7C384) |
| PoolSwapTest (swap router) | [`0xb02860dF9D8757Bf4649c067C278e77c62E1D911`](https://sepolia.etherscan.io/address/0xb02860dF9D8757Bf4649c067C278e77c62E1D911) |
| DemoPositionRouter (liquidity) | [`0x0061c82bAB6bcF11087E9B6C32C42a910Ce5e9a6`](https://sepolia.etherscan.io/address/0x0061c82bAB6bcF11087E9B6C32C42a910Ce5e9a6) |

| Pool | poolId | liquidity |
|---|---|---|
| Deal Room (KYC) | `0x8dcb9576689d61f45fbe7dda55cd88218200cd8c59b46fcccb8311fd2afcd88d` | 10,000e18 |
| Investor (KYC + accredited) | `0x47f214750b178afa1039d06dc2b1d3bdc908bdaf55f570a4efe023d8101bc223` | 10,000e18 |

Policies: `#1 Deal Room = [KYC_VERIFIED]`, `#2 Investor = [KYC_VERIFIED, ACCREDITED_INVESTOR]`.
`bootstrapLp` on both hooks = the deployer (add-liquidity only, empty pools only — see
"Bootstrapping a gated pool" below).

**ENS tenant** for `casaazul.eth`
(`namehash 0xc370deff09f061063f964c6329b0e2f76e18e210a00f5db98003d4ed686815b7`) is wired on the new
PassportResolver with **controller = the agent EOA**, not the registrar — so the backend binds
`<name>.casaazul.eth` directly via `resolver.setIdentity`, with no ENS NameWrapper approval step.
`setTenant` is first-come-first-served and not rotatable, so that choice is permanent.

### Environment

`apps/api/.env`:

```bash
CHAIN_ID=11155111
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<key>
DEMO_MODE=true

# one key: admin + agent + issuer signer + minter + scorer + ENS controller
ISSUER_SIGNER_PRIVATE_KEY=0x…      # the 0x8368… key
AGENT_PRIVATE_KEY=0x…              # same key

CLAIM_ISSUER_ADDRESS=0x997FfC7e02f405deF917d28481A4B5Da0b356d29
IDENTITY_FACTORY_ADDRESS=0x3c8315ed76bc95cD009B96516e6c6d60145f9c96
PASSPORT_RESOLVER_ADDRESS=0xB31f41e8258fFb3B8Ab0d0c0FB131516A16271ce
SCORE_REGISTRY_ADDRESS=0x73c51043524a84C375Adb710c40dfF6544E6Ea59
GATED_ERC20_ADDRESS=0xED7c73f2E57aBFF6919eE6bf76F6b0b5361eBb43
ENS_PARENT_NAME=casaazul.eth

# World ID v4
WORLD_APP_ID=app_…
WORLD_RP_ID=rp_…
WORLD_RP_SIGNING_KEY=0x…
WORLD_ACTION_PERSONHOOD=passportkit-personhood
WORLD_ACTION_KYC=passportkit-kyc
```

`apps/web/.env.local` — the four address vars are **required**, because the defaults compiled into
`lib/world-chain.ts` and `lib/hero-chain.ts` still point at the old stack:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WORLD_ENV=production
NEXT_PUBLIC_PRIVY_APP_ID=…
NEXT_PUBLIC_SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/<key>

NEXT_PUBLIC_IDENTITY_FACTORY_ADDRESS=0x3c8315ed76bc95cD009B96516e6c6d60145f9c96
NEXT_PUBLIC_CLAIM_ISSUER_ADDRESS=0x997FfC7e02f405deF917d28481A4B5Da0b356d29
NEXT_PUBLIC_PASSPORT_RESOLVER_ADDRESS=0xB31f41e8258fFb3B8Ab0d0c0FB131516A16271ce
NEXT_PUBLIC_GATED_ERC20_ADDRESS=0xED7c73f2E57aBFF6919eE6bf76F6b0b5361eBb43
```

### Reproduce

```bash
cd contracts
export RPC_URL=… DEPLOYER_PRIVATE_KEY=0x… ETHERSCAN_API_KEY=…
export ENS_PARENT_NODE=0xc370deff09f061063f964c6329b0e2f76e18e210a00f5db98003d4ed686815b7

forge script script/DeployPassportKit.s.sol --rpc-url $RPC_URL --broadcast --verify   # stack
# then, with the gate + factory it printed:
ELIGIBILITY_GATE_ADDRESS=… IDENTITY_FACTORY_ADDRESS=… SEED_LIQUIDITY=true \
  forge script script/DeployHooks.s.sol --rpc-url $RPC_URL --broadcast --verify       # hooks + pools
```

`AGENT_ADDRESS` / `ISSUER_SIGNER_ADDRESS` default to the deployer, which is what makes one key own
everything. `ENS_TENANT_CONTROLLER` defaults to that agent address.

### Still to deploy on Sepolia

`HouseTreasury` + CASA + `MandateHook` + the house pool (the `/concierge` rail), and the demo
actors' identities + claims. Both exist only inside `DeployAll.s.sol`, which builds an anvil world
from scratch; it needs a mode that reuses the stack above.

### Superseded — the previous stack (do not use)

The first Sepolia stack (admin/agent/signer `0xEc98…`) and the two hook generations pointing at it
are dead for our purposes: we hold none of its roles, and its `casaazul.eth` tenant is claimed by a
controller we do not control. Old identity stack: ClaimIssuer `0x56F9…`, IdentityFactory `0x2350…`,
EligibilityGate `0x5157…`, GatedERC20 `0xe3a2…`, ScoreRegistry `0x010c…`, PassportResolver (demo)
`0x14a83c7a…`. Old hooks: `0xfA1df80d…`/`0x7072E2b3…` (no bootstrap LP, unusable) and
`0x9296d270…`/`0x38161b21…` (pointing at the old gate). The failed-swap artifact
[`0xc1b5f813…`](https://sepolia.etherscan.io/tx/0xc1b5f8130ed1627732c2a5a55a6cb23f34ea5c236214d0516a3f66bd7f51992d)
was produced against `0x9296d270…` and remains a valid demonstration of the mechanism, but the
current pools are the ones above.

---

## Ethereum Sepolia — the FIRST stack (2026-07-25, superseded)

Deployed 2026-07-25 (startBlock **11350114**). Admin / agent / issuer-signer = `0xEc98B58F86a32aAd7B32E17f292e6B640487f2A4`.

| Contract | Address |
|---|---|
| **PassportResolver** | `0x36064023898d0451C6763a171e080b18123BE83E` |
| EligibilityGate | `0x51574D5830461FD38022987621C7bdf3a996b8d1` |
| IdentityFactory | `0x23504699EAcc1842d01998C0D57C53a2CF1638A0` |
| ClaimIssuer | `0x56F97734cC4d80af950538eAA6976398b5E58Fa9` |
| IssuerRegistry | `0xcAa549B8f1ef449BEeD00D7Bb88a828AB9E70AE7` |
| GatedERC20 | `0xe3a29101263567c400A0d4d47C52912d3Ed0a08d` |
| ScoreRegistry | `0x010c452FEC23669Be2D076Efe0CAEEb28c82Aa6E` |
| PassportSubnameRegistrar | `0xb41FfDBeB9Ac19359D861AB13F3E05356B68a34B` |

Policies wired: `#1 Deal Room = [KYC_VERIFIED]`, `#2 Investor = [KYC_VERIFIED, ACCREDITED_INVESTOR]`.
Tenant wired for `casaazul.eth` (namehash) → gate + policy #1.

### ENS
- `casaazul.eth` registered on the **ENSv2** Sepolia testnet (the classic v1 registrar is orphaned on this deployment). ENSv2 supports **custom resolvers** (interface unchanged), so `casaazul.eth`'s resolver can point at our **PassportResolver**.
- ENSv2 Sepolia: ETHRegistry `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67`, ETHRegistrar `0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA`.

### Live ENS demo (wired by `WireEnsDemo.s.sol`, 2026-07-25)
| Item | Value |
|---|---|
| **PassportResolver (DEMO — point casaazul.eth here)** | `0x14a83c7aE0667e90ff3863C6eF12539F67e4Cd58` |
| Demo identity (owner 0xEc98…) | `0xD2AD5CeB57cef5eDa821978a25c36DB6528D12b4` |
| Demo agent wallet | `0x000000000000000000000000000000000000a6E1` |

Live resolution (verified on-chain): `luiz.casaazul.eth` → `compliance.status = GREEN`; `bot.luiz.casaazul.eth` → `agent-registration = "1"` (ENSIP-25) + `agent.reputation = "87"`.

> **State as of 2026-07-26: `luiz.casaazul.eth` resolves to `REVOKED`, not `GREEN`.** The
> issuer's revocation latch is ON for that identity's KYC topic
> (`ClaimIssuer.revoked(0xD2AD…, KYC_VERIFIED) == true`; the accredited topic is untouched), so
> `EligibilityGate.isEligible(identity, 1)` returns `MISSING_KYC` and the resolver reports it
> faithfully. That is the money moment captured live on ENS — keep it if you want to open on the
> refusal, but restore it before any demo that has to start GREEN:
> ```bash
> cast send 0x56F97734cC4d80af950538eAA6976398b5E58Fa9 \
>   "setRevoked(address,uint256,bool)" \
>   0xD2AD5CeB57cef5eDa821978a25c36DB6528D12b4 \
>   $(python3 -c "print(int('$(cast keccak KYC_VERIFIED)',16))") false \
>   --rpc-url $RPC_URL --private-key $AGENT_PRIVATE_KEY   # needs AGENT_ROLE
> ```

Verify:
```bash
R=0x14a83c7aE0667e90ff3863C6eF12539F67e4Cd58
RPC=https://ethereum-sepolia-rpc.publicnode.com
cast call $R "text(bytes32,string)(string)" $(cast namehash luiz.casaazul.eth) "compliance.status" --rpc-url $RPC   # GREEN
```
Next: in the ENSv2 app set `casaazul.eth`'s resolver → the DEMO PassportResolver above so it resolves globally.

---

## Uniswap v4 hooks — LIVE on Ethereum Sepolia (2026-07-26)

A compliance-gated Uniswap v4 pool with **real liquidity that refuses the wallet which funded
it**. Deployed by `0x8368c1EAEad096124665E80D68eD0e763c242dC8`; every contract verified on
Etherscan.

| Contract | Address |
|---|---|
| **ComplianceHook** — policy #1 Deal Room | [`0x9296d27031bb2A1Bc4912095FF7bB017642CC880`](https://sepolia.etherscan.io/address/0x9296d27031bb2A1Bc4912095FF7bB017642CC880) |
| **ComplianceHook** — policy #2 Investor | [`0x38161b21c5A208416784d97147f14D53A298c880`](https://sepolia.etherscan.io/address/0x38161b21c5A208416784d97147f14D53A298c880) |
| mUSDC — Mock USD Coin (token0) | [`0x268c3BF1AF90f5Bd88B4fbf24fd358617493F3cA`](https://sepolia.etherscan.io/address/0x268c3BF1AF90f5Bd88B4fbf24fd358617493F3cA) |
| mCASA — Mock Casa Azul Share (token1) | [`0x77Cb80742E424E688A8AE5214000b9af7Ad7C384`](https://sepolia.etherscan.io/address/0x77Cb80742E424E688A8AE5214000b9af7Ad7C384) |
| PoolSwapTest (swap router) | [`0x4d7a2B21f66ee4f39A92456AFeBEF096a8125e14`](https://sepolia.etherscan.io/address/0x4d7a2B21f66ee4f39A92456AFeBEF096a8125e14) |
| DemoPositionRouter (liquidity) | [`0x62273D6355f9c5341267281f53aC00F55cca3D29`](https://sepolia.etherscan.io/address/0x62273D6355f9c5341267281f53aC00F55cca3D29) |

Both hook addresses end in **`0880`** — the low 14 bits are
`BEFORE_ADD_LIQUIDITY_FLAG | BEFORE_SWAP_FLAG`, which is what makes them valid v4 hooks and why
they must be CREATE2-mined. Both read the live `EligibilityGate` `0x51574D58…` and
`IdentityFactory` `0x23504699…`; neither carries any eligibility logic of its own.

Pools on the canonical PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`, mUSDC/mCASA,
fee 3000, tickSpacing 60, initialized at 1:1 and seeded full-range:

| Pool | poolId | liquidity |
|---|---|---|
| Deal Room (KYC) | `0x15733821d335c421770f8cbab57d443dcf29fe1969ed394928af08718d6da075` | 10,000e18 |
| Investor (KYC + accredited) | `0x33565851df36e4c733c2d602f1dec2ac54994d978a9169ed822d5f50198a651e` | 10,000e18 |

### The demo, as three on-chain facts

**1 — the pool refuses a swap, with the gate's own reason code.**
[`0xc1b5f813…`](https://sepolia.etherscan.io/tx/0xc1b5f8130ed1627732c2a5a55a6cb23f34ea5c236214d0516a3f66bd7f51992d)
is a **failed** transaction. Decoded, the revert is v4's `WrappedError` naming the hook and
`beforeSwap`, wrapping:

```
NotCompliant(0x8368c1EAEad096124665E80D68eD0e763c242dC8, "NO_IDENTITY")
```

The swapper is the wallet that deployed the pool and provided all of its liquidity. Seeding a
pool never buys the right to trade in it.

**2 — the refusal follows the issuer, not the pool.**

```bash
H=0x9296d27031bb2A1Bc4912095FF7bB017642CC880
RPC=https://ethereum-sepolia-rpc.publicnode.com
cast call $H "reasonFor(address)(bytes32)" 0x8368c1EAEad096124665E80D68eD0e763c242dC8 --rpc-url $RPC
#   -> NO_IDENTITY   (a wallet the IdentityFactory has never seen)
cast call $H "reasonFor(address)(bytes32)" 0xEc98B58F86a32aAd7B32E17f292e6B640487f2A4 --rpc-url $RPC
#   -> MISSING_KYC   (has an identity; the issuer's revocation latch is ON)
```

That second answer is the thesis in one call: the same latch that makes `luiz.casaazul.eth`
resolve `REVOKED` makes the Uniswap pool refuse. One revocation, every surface.

**3 — exit is never gated.** `beforeRemoveLiquidity` is off by design, so anyone who loses
compliance can still withdraw. Compliance blocks movement to a counterparty, never your own exit.

### Bootstrapping a gated pool

A gated pool has a chicken-and-egg problem: `beforeAddLiquidity` consults the gate, so the first
LP must already be compliant — but on a fresh deployment nobody is, and an empty pool proves
nothing. `ComplianceHook.bootstrapLp` is the narrowest possible fix, and it is
`0x8368c1EAEad096124665E80D68eD0e763c242dC8` on both hooks above:

- **one address**, fixed at construction, immutable — no admin, no setter, visible in the
  verified source;
- **add-liquidity only** — swaps are never exempt, which is exactly what tx 1 above demonstrates;
- **one-shot** — `isBootstrapping()` returns false the moment the pool holds liquidity, even for
  the bootstrap LP itself, so unverified capital cannot be stacked alongside verified capital;
- `address(0)` disables it entirely, checked explicitly so hookData declaring `address(0)` as the
  actor is never mistaken for a match.

`DeployAll.s.sol` (the local anvil world) passes `address(0)` — its operator is fully verified and
seeds through the gate like anyone else.

### Deploy transactions

| What | Tx |
|---|---|
| ComplianceHook (deal), CREATE2 | [`0x3f9a705b…`](https://sepolia.etherscan.io/tx/0x3f9a705b0d36b46c4e82c8d9b057f8970a9af90964aaeaa20e43af1df7942289) |
| ComplianceHook (investor), CREATE2 | [`0x6179df12…`](https://sepolia.etherscan.io/tx/0x6179df12a3b0ef6c844caf6c3e63e934e19b627879ea79d9e4c340d0d48072d9) |
| PoolManager.initialize (deal) | [`0x98a297d0…`](https://sepolia.etherscan.io/tx/0x98a297d0f40bd6b622d2634e40f91e3a3f00a8b3880d0d1069ea3e7477549639) |
| PoolManager.initialize (investor) | [`0xed771f35…`](https://sepolia.etherscan.io/tx/0xed771f358c96e8ca9d19532ff96cc2f65f5a5f1fd5c14d86a6671594f9c8e53e) |
| addLiquidity (deal), bootstrap LP | [`0xdca89d13…`](https://sepolia.etherscan.io/tx/0xdca89d13238613890d02132c5a959ed18d9c45add03d5e73f0d26fb55e898a3d) |
| addLiquidity (investor), bootstrap LP | [`0x2bb217ab…`](https://sepolia.etherscan.io/tx/0x2bb217ab3b04f54c8a75aedf4782069be2e935c8687471fe3240f07ab7081a90) |
| **swap → NotCompliant (failed, on purpose)** | [`0xc1b5f813…`](https://sepolia.etherscan.io/tx/0xc1b5f8130ed1627732c2a5a55a6cb23f34ea5c236214d0516a3f66bd7f51992d) |

~10.2M gas across both runs, about 0.026 ETH.

### Superseded (ignore these)

A first pass deployed hooks without `bootstrapLp` and a PROP/mUSD pair. Those pools can never be
seeded, so they are dead: hooks `0xfA1df80d…4880` / `0x7072E2b3…c880`, tokens
`0x282B09c5…` (mUSD) / `0x67FB48B3…` (PROP). A second pass on the current hooks used the same old
pair before mCASA/mUSDC existed; its liquidity is recoverable at any time via
`DemoPositionRouter` `0x08b3cb0e…`, since removing liquidity is ungated.

### Still to do on Sepolia

**The green path.** A *successful* swap needs a wallet that passes the policy, and none exists
yet: `0x8368…` has no identity, and the only identity (`0xD2AD5CeB…`) is KYC-latched. The
bootstrap exemption deliberately does not help here. One action from the `0xEc98…` key holder
unblocks it — either clear the latch and trade as `0xEc98…`, or `createIdentity(0x8368…)` plus a
signed KYC claim (Model B: issuer signs, holder submits).

**MandateHook** is not deployed here: it needs a `HouseTreasury`, which is anvil-only so far.

---


---

## Uniswap v4 hooks — deploying to Sepolia

`DeployAll.s.sol` builds a whole world from nothing and is anvil-only. For a chain where the
PassportKit stack already exists, use **`contracts/script/DeployHooks.s.sol`**: it deploys only
the Uniswap surface against the addresses above, so it is re-runnable and never touches the
identity stack.

### Why hooks need their own script

A v4 hook address must **encode its permissions in its low 14 bits** — `BaseHook`'s constructor
reverts otherwise. So the hook cannot be deployed with a plain `CREATE`: the script mines a salt
with `HookMiner` and deploys through the CREATE2 factory `0x4e59b448…4956C` (already present on
Sepolia). `forge script --broadcast` routes `new X{salt: s}` through that factory automatically,
which is why `HookMiner.find` is given `CREATE2_FACTORY` as the deployer. Both hooks request
`beforeSwap | beforeAddLiquidity`, so every mined address ends in `0880`.

### Canonical v4 addresses

| Contract | Ethereum Sepolia (11155111) | Base Sepolia (84532) |
|---|---|---|
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| PositionManager | `0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4` | `0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80` |
| StateView | `0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c` | `0x571291b572ed32ce6751a2cb2486ebee8defb9b4` |
| UniversalRouter | `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | `0x492e6456d9528771018deb9e87ef7750ef184104` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | (same) |

The script defaults `POOL_MANAGER` per chain id, so on either Sepolia you can leave it unset.

### Run

```bash
cd contracts
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export DEPLOYER_PRIVATE_KEY=0x...                                    # funded; pays every deploy
export ELIGIBILITY_GATE_ADDRESS=0x51574D5830461FD38022987621C7bdf3a996b8d1
export IDENTITY_FACTORY_ADDRESS=0x23504699EAcc1842d01998C0D57C53a2CF1638A0

forge script script/DeployHooks.s.sol --rpc-url $RPC_URL --broadcast -vvv
```

Roughly **5M gas** for the full run (two hooks + two pools + tokens + routers + liquidity).

Optional env:

| Var | Effect |
|---|---|
| `POOL_MANAGER` | Override the per-chain default |
| `TOKEN_A` / `TOKEN_B` | Use your own pair. Unset → deploys mCASA + mUSDC mocks and mints 1M of each to the deployer |
| `DEAL_HOOK` / `INVESTOR_HOOK` | Reuse hooks already deployed on this chain instead of mining new ones — point the same verified hooks at a new pair |
| `SEED_LIQUIDITY=true` | Also deploy the demo routers and add full-range liquidity to both pools |
| `BOOTSTRAP_LP` | The one address allowed to seed an EMPTY pool without passing the policy. Defaults to the deployer; set to the zero address for no exemption at all |
| `HOUSE_TREASURY` | Also mine `MandateHook` and open the CASA/spend-token pool |

Add `--verify --etherscan-api-key $ETHERSCAN_API_KEY` to verify the hooks on Etherscan.

On success it writes `deployments/<chainid>-hooks.json` (gitignored) with both hook addresses,
the pool parameters and the routers.

### The gotcha that costs an afternoon

`beforeAddLiquidity` is gated by the very hook you just deployed, so **nobody can seed the pool
unless they already pass the policy** — policy #1 for the deal pool, policy #2 for the investor
pool. That is what `BOOTSTRAP_LP` exists for, and why it defaults to the deployer: the first add
into an empty pool is exempt, everything after it is not (see "Bootstrapping a gated pool" above).

If you set `BOOTSTRAP_LP` to someone other than the deployer and still ask for `SEED_LIQUIDITY`,
the script pre-checks eligibility before broadcasting and refuses with the gate's own reason code
rather than burning gas on a revert:

```
deployer                 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
deal-room policy reason  MISSING_KYC
Error: SEED_LIQUIDITY needs a deployer passing BOTH policies …
```

Fix it by giving that wallet an identity and both claims first (`WireEnsDemo.s.sol` does exactly
this for its owner key), then re-run.

### Not gated: exit

`beforeRemoveLiquidity` is deliberately **off**. Compliance blocks movement to a counterparty,
never your own exit — deploying these hooks never traps anyone's funds.
