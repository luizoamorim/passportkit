# WHAT'S NEW — PassportKit Node (ETHGlobal Lisbon 2026, Continuity Track)

> Continuity submission. This file separates the **pre-existing baseline** (prior work) from the **delta built during the 36-hour window** (Fri Jul 24 21:00 → Sun Jul 26 08:00 WEST).
> *The base is disclosed. The delta is the project.*

---

## 2026-07-25 — One site, one demo command

- **Three demos became one website.** The Uniswap hook demo and the House Concierge
  demo were standalone node servers on their own ports, with their own HTML, their own
  chain world and their own wallet story. Both are now **routes on `apps/web`** —
  `/markets` and `/concierge` — beside the product's `/passport` and `/deal-room`. A
  visitor connects a wallet once on the landing page and walks all four: *get verified
  → enter the Deal Room → trade a compliant pool → hand an agent a mandate*.
- **One chain world.** `contracts/script/DeployAll.s.sol` replaces the two per-demo
  deploy scripts: one PassportKit stack, one v4 PoolManager, three pools (Deal Room,
  Investor, CASA/mUSD) and the house treasury, all written to a single
  `apps/web/demo-addresses.json`. This fixes the old bug where resetting one demo wiped
  the other's contracts — `↺ Reset` now resets the world both routes are reading.
- **One command.** `npm install && make demo` starts anvil (or reuses one already
  listening), deploys that world and serves the site on **:3003** with `DEMO_MODE=true`.
  `make demo-stop` takes it down and only kills a chain `make demo` itself started;
  `make demo-explorer` puts Otterscan on :5100 over the demo chain. Both ports are
  overridable (`RPC_PORT=`, `WEB_PORT=`) so two worlds can run side by side.
- **The demo runtime moved into Next.** The two `server.js` files are now route handlers
  under `apps/web/src/app/api/demo/**` (`world`, `markets`, `concierge`, `tx/<hash>`,
  `vendor/invoice`) over the same viem libs, moved unchanged, in `apps/web/src/lib/demo/`.
  Every handler calls `assertDemo()` first and answers **403 unless `DEMO_MODE=true`** —
  the anvil actor keys stay server-side and never reach a `NEXT_PUBLIC_*` var. With the
  flag off, `/passport` and `/deal-room` work normally and the two demo routes say so.
- **One design system, one wallet.** A shared `AppShell` (nav, connect button, chain
  chip, demo banner) is mounted by the root layout, so the connection survives every
  navigation; the two demo pages were rebuilt on the app's existing tokens instead of
  porting their standalone CSS.
- **Retired:** `apps/hook-demo/` and `apps/concierge/`, their Makefile targets and their
  deploy scripts are deleted. **The `:4180` and `:4190` instructions in the entry below
  are historical — `make demo` is the only demo command now.**
- **Tests:** 116 green in `contracts/` (unchanged — no contract was touched) and 39
  node:test in `apps/web` (decider rules, x402 client, evidence hashing, revert
  decoding, pool-position aggregation), up from 28 across the two retired apps.

---

## 2026-07-25 — Uniswap v4 hook + House Concierge Agent

- **Uniswap v4 `ComplianceHook` + local demo** (PR #1) — the AccessGate that guards the
  Deal Room now also guards a v4 pool: `beforeSwap` / `beforeAddLiquidity` revert
  `NotCompliant(wallet, reasonCode)`, exit is deliberately ungated. Self-contained demo
  app (`apps/hook-demo`, `make hook-demo` → :4180) with self-healing anvil boot, two
  pools showing policy separation, and a built-in tx inspector.
- **Caller-bound `DemoPositionRouter` fix** — the demo liquidity router now binds
  positions to the calling actor instead of the router address, so per-actor LP
  positions read back correctly (and the hook sees the real provider).
- **House Concierge Agent** — new agents layer: `HouseToken` (CASA scrip),
  `HouseTreasury` (owners, m-of-n approvals, agent mandate, payment queue,
  `isAgentInGoodStanding`) and `MandateHook` (gates the CASA/mUSD pool). Two spending
  rails — autonomous below the per-tx cap (exact-output swap CASA→mUSD through the
  gated pool, then settle the vendor's **x402** invoice: 402 → pay → retry with
  `X-PAYMENT`), owner-approved above it — both gated on the owners' live passports, so
  revoking one owner's KYC kills the agent on both rails in the same block. Mock x402
  vendor server included; decision engine is a **0G-ready adapter**
  (`DECIDER=mock|openai|zerog`) whose TEE attestation replaces the local decision hash
  at event time. Runtime + UI in `apps/concierge` (`make concierge-demo` → :4190).
- **Tests:** 29 new Solidity tests (HouseToken 4, HouseTreasury 18, MandateHook 7 —
  93 green in `contracts/`) and 28 new JS tests (`apps/concierge`: decider rules, x402
  client, evidence hashing, revert decoding).

---

## Baseline (prior work — NOT judged as new)
- **Project:** PassportCreds by Node — our ETHGlobal build (claim registry, soulbound passport, access gate, Deal Room).
- **Repo / commit:** `[baseline repo URL]` @ `[baseline commit hash]` — imported in the initial commit, labeled `pre-existing baseline`.
- **What it already did:** Privy embedded-wallet onboarding, passport dashboard, a gated Deal Room, a NestJS backend with a verification/webhook flow.

---

## Reused from baseline (kept, adapted)
App shell — so the 36h go to the delta, not to rebuilding auth/UI:
- **Onboarding:** Privy embedded wallet (`PrivyAppProvider`, `PrivyLoginButton`, `WalletSetupCard`).
- **Gated app (enforcement surface):** the Deal Room (`app/deal-room/*`, `DealRoom{Locked,Limited,Unlocked,Blocked}`) — repointed to read the new `EligibilityGate`.
- **Dashboard:** passport dashboard components (`PassportCard`, `ClaimStatusBadge`, `EvidenceCard`, `TransactionTimeline`, `AccessDecisionBanner`, …).
- **Backend scaffolding:** NestJS + Prisma, the `attester` module (evolved into the issuer signing service), the webhook receiver, viem plumbing.
- **Optional:** `CompliancePassport` (ERC-721 + ERC-5192) reused as the soulbound badge pointing to the identity.

---

## New this weekend (the delta — judged)
Built in-event, incremental commits, from the specs in `docs/`:

**Contracts (Ethereum Sepolia):**
- **OnchainID Identity** (ERC-734/735) — replaces the old ClaimRegistry; issuer-signed claims, Model B writes.
- **IdentityFactory** — one Identity per wallet; resolves `wallet → identity` for the surfaces.
- **ClaimIssuer** (EIP-712) — signs claims; the holder submits them. No privileged writer. Revocation is an issuer-held latch (`setRevoked`).
- **IssuerRegistry** — trusted issuers per claim topic.
- **EligibilityGate** — `isEligible(identity, policyId) → (bool, reasonCode)`; the one read enforced everywhere.
- **GatedERC20** — permissioned transfer gate (`_update` → EligibilityGate; exits always free).
- **PassportResolver** — ENS **read-through** resolver, **tenant-aware** (text records computed live from the gate; one resolver serves N white-labels).
- **PassportSubnameRegistrar** — issues ENS subnames **by code** (the white-label/kit piece).
- **ComplianceHook** — Uniswap v4 hook gating swaps/liquidity by eligibility (proven by test suite).

**Integrations & services:**
- **World ID** — real proof-of-personhood (Identity Attestations + Selfie Check) → claims.
- **Mock evidence attester** — labeled placeholder for KYC/accredited (never described as regulated verification).
- **Issuer signing service** — EIP-712 claim signing.
- **ENS** — `passportkit.eth` (new brand) on Ethereum Sepolia + per-identity subnames issued by code (white-label proof with one tenant).

**The demo is the refusal:** revoke one claim → transfer fails + swap reverts + gated app closes + ENS record flips — because all four surfaces read the same `isEligible`.

---

## Boundaries / honesty
- **Nothing from our private production codebase** is in this repo — one sentence in Q&A only.
- **World ID is real** (personhood). **KYC/accredited are labeled mocks**; regulated/TEE providers plug into the same interface later.
- **No hard-coded demo values.** ENS resolves live.
- **AI-assisted, attributed:** see `AI-USAGE.md`; specs + prompts ship in `docs/`.

## Addresses
See `README.md` → address table (`[filled at submission]`).
