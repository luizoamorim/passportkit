# Deployments

## Ethereum Sepolia (chainId 11155111)

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

Deployed by `0x8368c1EAEad096124665E80D68eD0e763c242dC8`, **all four contracts verified on
Etherscan**. 3.64M gas, ~0.0093 ETH at 2.55 gwei.

| Contract | Address | |
|---|---|---|
| **ComplianceHook** — policy #1 Deal Room | [`0xfA1df80d0f8Df129Df0CB6EdBF3aDA2f36544880`](https://sepolia.etherscan.io/address/0xfA1df80d0f8Df129Df0CB6EdBF3aDA2f36544880) | verified |
| **ComplianceHook** — policy #2 Investor | [`0x7072E2b3e95caA88863857cD9E7941b8DF21c880`](https://sepolia.etherscan.io/address/0x7072E2b3e95caA88863857cD9E7941b8DF21c880) | verified |
| mUSD (token0) | [`0x282B09c5f932D28caA086863d4bA78A4935db967`](https://sepolia.etherscan.io/address/0x282B09c5f932D28caA086863d4bA78A4935db967) | verified |
| PROP (token1) | [`0x67FB48B3Bdc0fc9d744dF3d9a7933d15b879b2bE`](https://sepolia.etherscan.io/address/0x67FB48B3Bdc0fc9d744dF3d9a7933d15b879b2bE) | verified |

Both hook addresses end in **`0880`** — the low 14 bits are
`BEFORE_ADD_LIQUIDITY_FLAG | BEFORE_SWAP_FLAG`, which is what makes them valid v4 hooks. Both read
the live `EligibilityGate` `0x51574D58…` and `IdentityFactory` `0x23504699…`; neither carries any
eligibility logic of its own.

Pools on the canonical PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`, mUSD/PROP,
fee 3000, tickSpacing 60, initialized at 1:1:

| Pool | poolId | liquidity |
|---|---|---|
| Deal Room | `0x86236cd33660e6af718bc9e17390c2df2c96f2964307b9dc8dcdd712df71d2de` | 0 |
| Investor | `0xfe72b0f15e2cb85fc0d1dc5b235eeac3ef7ccb76e9701edf4584c4c9f1b413a9` | 0 |

Deploy transactions:

| What | Tx |
|---|---|
| ComplianceHook (deal), CREATE2 | [`0x38afb8d8…`](https://sepolia.etherscan.io/tx/0x38afb8d87f349ed3008fd44a38fa2d0e091c74bcd5aa0345b2170635684b0bf0) |
| ComplianceHook (investor), CREATE2 | [`0xa5c212cd…`](https://sepolia.etherscan.io/tx/0xa5c212cd0bfb7dc63e3046b8812050084d5fb8eb4c46a446873827eb7fd08f73) |
| PoolManager.initialize (deal) | [`0xb274eb3e…`](https://sepolia.etherscan.io/tx/0xb274eb3ec65f3a77287598d874610c75ee2f4c2967fec4dd16ba62c3691ed73f) |
| PoolManager.initialize (investor) | [`0xffe38f06…`](https://sepolia.etherscan.io/tx/0xffe38f06e86d084feb69ef929695f59d25f83d9a069056e19b8d626f7de01f79) |

### The gate answering live, on a public chain

```bash
H=0xfA1df80d0f8Df129Df0CB6EdBF3aDA2f36544880
RPC=https://ethereum-sepolia-rpc.publicnode.com
cast call $H "reasonFor(address)(bytes32)" 0x8368c1EAEad096124665E80D68eD0e763c242dC8 --rpc-url $RPC
#   -> NO_IDENTITY   (a wallet the IdentityFactory has never seen)
cast call $H "reasonFor(address)(bytes32)" 0xEc98B58F86a32aAd7B32E17f292e6B640487f2A4 --rpc-url $RPC
#   -> MISSING_KYC   (has an identity; the issuer's revocation latch is ON)
```

That second answer is the whole thesis in one call: the same latch that makes
`luiz.casaazul.eth` resolve `REVOKED` also makes the Uniswap pool refuse. One revocation, every
surface.

### Still to do on Sepolia

Liquidity is 0 in both pools, so the **green path can't be shown on Sepolia yet** — the refusal
path works today. `beforeAddLiquidity` consults the same gate, and no wallet currently passes:
`0x8368…` has no identity, and the only identity that exists (`0xD2AD5CeB…`) is KYC-latched. Needs
one action from the `0xEc98…` key holder — either clear the latch and LP as `0xEc98…`, or
`createIdentity(0x8368…)` plus a signed KYC + accredited claim. Then re-run with
`SEED_LIQUIDITY=true`.

`MandateHook` is not deployed here: it needs a `HouseTreasury`, which is anvil-only so far.

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

Roughly **10.5M gas** for the full run (two hooks + two pools + tokens + routers + liquidity).

Optional env:

| Var | Effect |
|---|---|
| `POOL_MANAGER` | Override the per-chain default |
| `TOKEN_A` / `TOKEN_B` | Use your own pair. Unset → deploys PROP + mUSD mocks and mints 1M of each to the deployer |
| `SEED_LIQUIDITY=true` | Also deploy the demo routers and add full-range liquidity to both pools |
| `HOUSE_TREASURY` | Also mine `MandateHook` and open the CASA/spend-token pool |

Add `--verify --etherscan-api-key $ETHERSCAN_API_KEY` to verify the hooks on Etherscan.

On success it writes `deployments/<chainid>-hooks.json` (gitignored) with both hook addresses,
the pool parameters and the routers.

### The gotcha that costs an afternoon

`beforeAddLiquidity` is gated by the very hook you just deployed, so **the deployer cannot seed
its own pool unless it already passes the policy** — policy #1 for the deal pool, policy #2 for
the investor pool. The script pre-checks this before broadcasting and refuses with the gate's own
reason code rather than burning gas on a revert:

```
deployer                 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
deal-room policy reason  MISSING_KYC
Error: SEED_LIQUIDITY needs a deployer passing BOTH policies …
```

Fix it by giving the deployer an identity and both claims first (`WireEnsDemo.s.sol` does exactly
this for its owner key), then re-run. Without `SEED_LIQUIDITY` the hooks and pools deploy fine and
you can add liquidity later from any compliant wallet.

### Not gated: exit

`beforeRemoveLiquidity` is deliberately **off**. Compliance blocks movement to a counterparty,
never your own exit — deploying these hooks never traps anyone's funds.
