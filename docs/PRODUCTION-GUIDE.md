# PassportKit — production guide

State of the system as of **2026-07-26**, on `develop` @ `0aa5c37`. Three sections
answer three questions: what is real, what is mocked, what is missing. Then the
env inventory, the deploy order, and the actions that need a human.

---

## 1. What is real and production-shaped

**The contracts.** `IssuerRegistry`, `ClaimIssuer`, `IdentityFactory`, `Identity`,
`EligibilityGate`, `GatedERC20`, the two ENS contracts, `ComplianceHook`,
`MandateHook`, `HouseTreasury`, `HouseToken`. 116 Foundry tests, all green, run
against the real stack rather than mocks of it. Claims are EIP-712 signed by the
issuer and submitted by the holder (Model B); revocation is a latch on the issuer;
expiry is enforced at read time. Nothing about this is demo-only.

**The eligibility model.** One question — `EligibilityGate.isEligible(identity,
policyId)` — answered for every surface: the Deal Room, the gated token, the ENS
resolver, the Uniswap v4 pools, and the agent treasury. Policy 1 = KYC, policy 2 =
KYC + accredited. Reason codes (`MISSING_KYC`, `MISSING_ACCREDITED`, `NO_IDENTITY`,
`NO_POLICY`) come from the gate itself, so no surface can disagree with another.

**The v4 hooks.** `ComplianceHook` gates `beforeSwap` + `beforeAddLiquidity` and
deliberately leaves `beforeRemoveLiquidity` off — exit is never gated, funds are
never trapped. `MandateHook` does the same for the agent's budget pool and enforces
the per-transaction cap on-chain. Both mine their permission bits via CREATE2.

**The agent authority model.** An agent never holds a passport. `HouseTreasury.
isAgentInGoodStanding` derives it: mandate exists, not revoked, not expired, **and
every owner still passes the gate live**. Both spending rails consult that one view,
so revoking one owner's KYC cuts the agent off in the same block.

**The web app.** `apps/web` builds (`next build` passes), is one site with a shared
shell, and the demo runtime is gated server-side: every `/api/demo/*` route returns
403 unless `DEMO_MODE=true`, actor keys never reach the browser, and the world file
is gitignored so a hosted build has nothing to sign with even if the flag were
mis-set.

---

## 2. What is mocked (and honestly labelled)

| Thing | Reality | Where |
|---|---|---|
| Chain | local anvil, one world per `make demo` | `DeployAll.s.sol` |
| Actors | anvil dev accounts #0–#4, keys held server-side | `apps/web/env.example` |
| Tokens | `MockERC20` PROP / mUSD, plus CASA house scrip | `DeployAll.s.sol` |
| Agent's brain | `DECIDER=mock` — deterministic rules, no network | `lib/demo/deciders.js` |
| x402 vendor | our own mock plumber at `/api/demo/vendor/invoice` | see §6 |
| Time | `⏩ 1 year` uses `evm_increaseTime`; `↺ Reset` redeploys | local only |
| Passport evidence | the product's "Simulate Verified" path | `apps/api` |
| Reputation | `ScoreRegistry` holds demo scores | `DeployPassportKit.s.sol` |

None of these lie in the UI: mock mode is labelled, refusals carry the real
on-chain reason code, and every transaction shown is a real transaction on the
local chain.

---

## 3. What is still missing development

1. **Any-wallet / WalletConnect.** Built in PR #12, but it targets the World-ID
   branch and is not on `develop`. Today the only connect paths are injected
   MetaMask or Privy, and they are mutually exclusive. `WalletConnectControl` in
   `AppShell.tsx` is the single swap point.
2. **World ID.** PR #11 — personhood claims, the `/passport` World flow.
3. **0G decider.** `DECIDER=zerog` is a stub that throws with the exact broker SDK
   calls to make. Event-day work by design (the 0G track judges progress made
   during the window).
4. **The Graph.** No subgraph yet; `DeployPassportKit.s.sol` already writes
   `startBlock` for one.
5. **Hosted demo hardening.** The demo routes have no auth and no rate limit. Safe
   locally; see §7 before ever setting `DEMO_MODE=true` on a public host.
6. **ESLint is a silent no-op** — `next build` fails to load
   `@typescript-eslint/no-unused-expressions` and continues, so `apps/web` is
   effectively unlinted (root eslint 9 vs `apps/web` eslint 8).
7. **`server-only`** is not installed; the demo-key boundary is convention plus a
   grep, not compiler-enforced.
8. **`apps/web/.env.example`** has no pointer to `apps/web/env.example` (agents are
   blocked from writing that path — one human edit, wording in §4).

---

## 4. Environment variables

### 4.1 Local demo — nothing required

`make demo` sets `DEMO_MODE` and `RPC_URL`; all five actor keys default to anvil
accounts. Optional, in `apps/web/.env.local` (copy from `apps/web/env.example`):

| Var | Why | Where to get it |
|---|---|---|
| `DECIDER=openai` | agent reasons with a model instead of mock rules | see below |
| `OPENAI_API_KEY` | any OpenAI-compatible key | platform.openai.com, or Google AI Studio |
| `OPENAI_BASE_URL` | the compat endpoint (client appends `/chat/completions`) | OpenAI default, or Gemini's OpenAI-compatibility path |
| `OPENAI_MODEL` | e.g. `gpt-4o-mini`, or a Gemini model id | provider docs |
| `EXPLORER_URL` | makes tx hashes clickable | `http://localhost:5100` with `make demo-explorer`, or `https://sepolia.etherscan.io` |
| `DEMO_VENDOR_URL` | point at a real x402 seller | see §6 |

Any decider error falls back to the mock rules and appends `(fallback: mock rules)`
to the rationale, so a wrong value degrades instead of breaking.

### 4.2 Browser — only three are read

`NEXT_PUBLIC_API_URL` (the NestJS API behind `/passport`), `NEXT_PUBLIC_PRIVY_APP_ID`
(dashboard.privy.io → App ID; **set = Privy replaces MetaMask**, blank = MetaMask),
`NEXT_PUBLIC_EXPLORER_URL`. `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is a reserved
name — no code reads it until PR #12 lands.

### 4.3 Contract deployment

| Var | Notes |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | pays for the deploy; becomes admin unless overridden |
| `AGENT_ADDRESS` | gets `AGENT_ROLE` (creates identities, sets revocations). Defaults to admin |
| `ISSUER_SIGNER_ADDRESS` | the EIP-712 signer authorised in `ClaimIssuer`. Defaults to admin |
| `ENS_NAMEWRAPPER_ADDRESS` | defaults to the Sepolia NameWrapper |
| `ENS_PARENT_NODE` | namehash of your parent `.eth`; leave 0 to skip ENS wiring |
| `RPC_URL` | Alchemy / Infura / publicnode |

Generate keys with `cast wallet new`. **The signer address must be the key the API
signs claims with** — a mismatch means every claim fails `isClaimValid`.

### 4.4 `apps/api` (only needed for `/passport` and `/deal-room`)

`DATABASE_URL` (Postgres — `make db`), `PORT`, `CORS_ORIGIN`, `WEBHOOK_SECRET`,
`RPC_URL`, `CHAIN_ID`, `ISSUER_SIGNER_PRIVATE_KEY`, `AGENT_PRIVATE_KEY`, the seven
contract addresses from §5, `POLICY_DEAL_ROOM=1`, `POLICY_INVESTOR=2`, plus
`PRIVY_*`, `WORLD_*` and `CRE_*` for those integrations. A fresh clone also needs
`npx prisma generate` — nothing runs it automatically.

---

## 5. Deploying the contracts, in order

The order is already encoded in `contracts/script/DeployPassportKit.s.sol` — use it
rather than deploying by hand, because several constructors take addresses of
earlier contracts and two of them also need wiring calls afterwards.

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x…   AGENT_ADDRESS=0x…   ISSUER_SIGNER_ADDRESS=0x…
export RPC_URL=https://…          ENS_PARENT_NODE=0x…      # 0 to skip ENS
forge script script/DeployPassportKit.s.sol --rpc-url $RPC_URL --broadcast --verify
```

What it does, and why the order cannot change:

1. **`IssuerRegistry(admin)`** — no dependencies.
2. **`ClaimIssuer(agent, signer)`** — then `registry.setTrusted(issuer, topic, true)`
   for `KYC_VERIFIED`, `PROOF_OF_PERSONHOOD`, `ACCREDITED_INVESTOR`. *An untrusted
   issuer means every claim is ignored at read time — this wiring step is not
   optional.*
3. **`EligibilityGate(admin, registryAddr)`** — then `setPolicy(1, [KYC])` and
   `setPolicy(2, [KYC, ACCREDITED])`. *A policy with no topics returns `NO_POLICY`
   and refuses everyone.*
4. **`IdentityFactory(agent, registryAddr)`** — needs the registry so each
   `Identity` it mints can check issuers.
5. **`ScoreRegistry(agent)`** — independent, but the resolver needs it next.
6. **`PassportResolver(identityFactory, scoreRegistry)`** — both must already be
   deployed **with code**; the constructor reverts on an EOA or zero address.
7. **`PassportSubnameRegistrar(nameWrapper, resolver, agent)`** — last, because it
   binds names to the resolver.

It writes `contracts/deployments/<chainid>.json` with every address plus the
`startBlock` — that file is the input to the API `.env`, the web `.env`, and a
future subgraph.

**Deployed separately, because each needs a policy decision:**

- **`GatedERC20(name, symbol, gate, resolver, policyId, admin)`** — one per gated
  asset.
- **`ComplianceHook(poolManager, gate, resolver, policyId)`** — one per pool policy,
  and **must be deployed via CREATE2 with a mined salt** (`HookMiner`): v4 encodes
  the hook's permissions in its address bits, so a plain `new` reverts. PoolManager:
  Ethereum Sepolia `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`, Base Sepolia
  `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`.
- **`HouseTreasury(owners[], threshold, spendToken, gate, resolver, policyId,
  tokenName, tokenSymbol)`** — deploys its own `HouseToken`; then
  `grantMandate(agent, perTxCap, expiresAt)` and `fundConcierge(amount)`.
- **`MandateHook(poolManager, treasury)`** — after the treasury, also CREATE2-mined.

`DeployAll.s.sol` does all of the above in one shot for the **local demo world** and
is the reference implementation for a testnet deploy.

---

## 6. x402 — findings as of 2026-07-26

Researched against primary sources this week, because the ecosystem moved:

- **Governance:** x402 was transferred from Coinbase to the **x402 Foundation**
  under the Linux Foundation, operationally launched **2026-07-14**. The canonical
  repo is now `github.com/x402-foundation/x402`; `coinbase/x402` is a mirror.
- **Networks:** a live query of the public facilitator (`x402.org/facilitator/supported`)
  returns **Base Sepolia**, Solana Devnet, and several other testnets — **not
  Ethereum Sepolia, not Ethereum mainnet**. CDP's hosted facilitator covers Base,
  Polygon, Arbitrum, World and Solana on mainnet, and requires a CDP account.
- **Hosted testnet sellers:** none that is documented as a stable "just curl this"
  endpoint. Self-hosting the seller is still the norm.
- **Spec version:** v1 and v2 coexist. v1 uses the `X-PAYMENT` header and
  `maxAmountRequired`; **v2 renames the headers to `PAYMENT-REQUIRED` /
  `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, moves them to base64 JSON, switches
  `network` to CAIP-2 (`eip155:84532`), and renames `maxAmountRequired` → `amount`.**
  Our implementation is v1-shaped and simplified; it is a faithful 402 → pay →
  retry flow, not a spec-complete client.

**Therefore:** no facilitator will settle against a local anvil chain or Ethereum
Sepolia. The options are (a) keep the self-hosted mock vendor — honest, and what
the demo does today; or (b) move the whole demo to **Base Sepolia** and use
`https://x402.org/facilitator` (no signup) with Circle's Base Sepolia USDC
`0x036CbD53842c5426634e7929541eC2318f3dCF7e` from `faucet.circle.com`. Uniswap v4
is deployed on Base Sepolia, so the hooks travel — but it is a whole-demo move, not
a config flip.

---

## 7. Actions that need a human

1. **Add the pointer to `apps/web/.env.example`** (agents are blocked from that
   path). Two lines, near the top:
   `# For the LOCAL demo runtime (DEMO_MODE, anvil actor keys, DECIDER), see`
   `# apps/web/env.example — this file is the hosted/testnet template.`
2. **Decide the demo's home.** Local (recommended for judging — reliable, resettable,
   and everything works) or hosted. If hosted with `DEMO_MODE=true`, first: put auth
   or a secret path in front of `/api/demo/*`, fund dedicated throwaway keys, and
   disable reset in that environment. Those routes sign with server-held keys for
   anyone who can reach them.
3. **If you want a real x402 leg**, decide on the Base Sepolia move (§6) — it is a
   chain migration, not an env change.
4. **Fix the ESLint loader** so `apps/web` is actually linted (align eslint versions
   across the workspace), and add `server-only`.
5. **Merge PR #12** (any-wallet) if WalletConnect matters for the demo; it currently
   targets the World-ID branch rather than `develop`.
