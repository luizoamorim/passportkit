# Hero Demo Flow — the one guided journey (Sepolia, real, ENS-strong)

**Branch:** `feature/web-hero-flow`. A single guided page that walks the whole PassportKit story on
**real Ethereum Sepolia**, wallet = **Privy** (embedded), verification = **real World ID**, identity +
compliance + **live ENS** all on-chain, ending on the **money moment**: revoke the person → their agent
is blocked on Casa Azul's compliant liquidity.

> Decisions locked (2026-07-26): **(1) Sepolia real end-to-end** — the Uniswap v4 pool is anvil-only, so
> "Casa Azul liquidity" is the deployed **GatedERC20** transfer gate (a real enforcement surface).
> **(2) ENS issued live per user** — `<name>.casaazul.eth` bound on-chain at onboarding, resolving
> compliance status live; the agent gets `bot.<name>.casaazul.eth` with ENSIP-25 + reputation.

## The narrative (what the page shows, in order)

1. **Login with Privy** → embedded wallet `W` generated. (MetaMask fallback.)
2. **Verification 1 — World Identity Check** (document-backed, `minimum_age: 18`):
   - no identity yet → backend `createIdentity(W)` (+ gas drip) → **Identity `I`**.
   - backend issues **`<name>.casaazul.eth` → I** (live ENS) — shown immediately, resolving `compliance.status`.
   - World proof → backend signs `KYC_VERIFIED` → user `submitClaim` → **tx log**.
   - passport → **LIMITED** (KYC only).
3. **Verification 2 — Accredited** (labeled mock, `/issuer/mock-claim`):
   - signs `ACCREDITED_INVESTOR` → user `submitClaim` → tx log → passport → **GREEN**.
4. **Prove personhood — World Selfie Check** → `PROOF_OF_PERSONHOOD` (real). Gates agent creation
   ("prove you're human before you delegate to an agent"). Uses the 2nd World prize.
5. **Create an agent** = a **new wallet `A`** (fresh keypair, key held in session):
   - backend `linkAgent(A, I)` (Model A: `identityOfWallet[A] = I`) + gas drip + mint Casa Azul tokens to `A`.
   - backend binds **`bot.<name>.casaazul.eth` → I** + `setScore(A, …)` → agent name resolves
     **ENSIP-25 `agent-registration = 1`** + **`agent.reputation`** live.
6. **Casa Azul liquidity** — the agent **acts**: `A` does a **GatedERC20 transfer** (Casa Azul's compliant
   token). `GatedERC20._requireEligible` resolves `identityOfWallet(A) = I` → `gate.isEligible(I, policy)`
   → **OK** (person is KYC'd) → transfer succeeds. Shown as "agent transacting on Casa Azul liquidity".
7. **Revoke** — issuer latches the person's KYC: `ClaimIssuer.setRevoked(I, KYC, true)` (agent key).
   Person → not eligible. ENS `compliance.status` flips to **REVOKED** live.
8. **Agent fails** — `A` retries the transfer → `identityOfWallet(A) = I` → `isEligible = false` →
   **transfer REVERTS** (`NotEligible`, reason `MISSING_KYC`). The money moment: revoke the human, the
   agent dies with them. (Restore = `setRevoked(false)` re-opens.)

ENS is on stage at steps 2, 5, 6, 7 — the name is the throughline (person status + agent registration +
reputation, all resolved live from our `PassportResolver`).

## Deployed contracts (Sepolia — docs/DEPLOYMENTS.md)
IdentityFactory `0x2350…` (createIdentity, linkAgent, identityOfWallet) · ClaimIssuer `0x56F9…`
(isClaimValid, setRevoked; signer 0xEc98) · EligibilityGate `0x5157…` · **GatedERC20 `0xe3a2…`**
(mint = MINTER_ROLE = 0xEc98; `_update` gates via `identityOfWallet`→`isEligible`) · **PassportResolver
(demo) `0x14a83c7a…`** (controller 0xEc98 → `setTenant`/`setIdentity`) · ScoreRegistry `0x010c…`
(setScore) · policies #1 Deal Room=[KYC], #2 Investor=[KYC, ACCREDITED].
Parent node = `namehash(casaazul.eth)`; tenant already set (controller 0xEc98) on the demo resolver.

## Backend work (`apps/api`)
- `POST /identity/create` (exists) → **add a gas drip** (agent sends ~0.005 ETH to `W` so it can submit).
- `POST /identity/issue-subname { identity, label }` (**new**) → `resolver.setIdentity(namehash(label.casaazul.eth), parentNode, identity)`. Agent (controller) signs.
- `POST /identity/link-agent { agentWallet, personIdentity, label }` (**bring from `feature/backend-link-agent`, extend**) → `linkAgent` + issue `bot.<label>.casaazul.eth` + `setScore` + gas drip + `GatedERC20.mint(agentWallet, amt)`.
- `POST /world/verify` (exists) — KYC (document) + personhood (selfie).
- `POST /issuer/mock-claim` (exists) — accredited (labeled mock).
- `POST /issuer/revoke` (exists) — the money moment.
- Env: `ENS_PARENT_NAME=casaazul.eth`, `PASSPORT_RESOLVER_ADDRESS=0x14a83c7a…`, `GATED_ERC20_ADDRESS=0xe3a2…`, `SCORE_REGISTRY_ADDRESS=0x010c…`, plus the existing AGENT/ISSUER keys. `DEMO_MODE` stays the guard on mock-claim/revoke.
- Runs DB-free: extend `world-main.ts` into a `hero-main.ts` (ConfigModule + WorldModule + IdentityModule + IssuerModule) — no Prisma/Postgres.

## Frontend work (`apps/web`)
- New guided route **`/hero`** (leave `/`, `/passport`, `/markets`, `/concierge` intact). Uses the shell + Privy wallet.
- Client-side viem for the user's own txs (Model B `submitClaim`) and the **agent's** txs (fresh keypair kept in React state for the session; frontend signs the agent's GatedERC20 transfer).
- Live ENS everywhere via `PassportResolver.text(node, key)` (`compliance.status`, `agent-registration[..]`, `agent.reputation[..]`).
- Components: `HeroStepper` (the 8 steps), `EnsNameCard` (the throughline — big), `PassportBadge` (NONE→LIMITED→GREEN→REVOKED), `TxRow` (etherscan links), `AgentCard` (wallet + ENSIP-25 + reputation), `CasaAzulLiquidity` (agent transfer button + result), `MoneyMomentRevoke` (the hero button).
- Reuse `lib/world-chain.ts` (getIdentity, submitClaim, getClaimValid, TOPICS) + `lib/world-api.ts`; add `lib/hero-chain.ts` (agent keypair, GatedERC20 transfer, resolver reads, gas/status helpers) + `lib/hero-api.ts` (create/issue-subname/link-agent/revoke calls).

## Gas model (self-contained demo)
Fresh Privy `W` and fresh agent `A` have no Sepolia ETH. The backend **agent key 0xEc98 drips gas**
(~0.005 ETH) to each when it provisions them (identity create / agent link), so the user never touches a
faucet. The agent also gets Casa Azul tokens minted so it has something to transfer.

## Build phases (we go one at a time)
- **P1 — Backend:** gas drip on create; `POST /identity/issue-subname`; `POST /identity/link-agent` (link + bot subname + score + drip + mint); `hero-main.ts` DB-free bootstrap. Verify with curl.
- **P2 — Frontend scaffold:** `/hero` page + `HeroStepper` + Privy connect + step 1–3 (World KYC → identity → live ENS → submit → LIMITED; accredited → GREEN). Live ENS card.
- **P3 — Agent:** step 4 (Selfie Check personhood) + step 5 (create agent, link, bot subname + reputation) + `AgentCard`.
- **P4 — Casa Azul + money moment:** step 6 (agent GatedERC20 transfer OK) + step 7 (revoke) + step 8 (agent transfer REVERTS). `MoneyMomentRevoke`.
- **P5 — Polish:** ENS-forward visual, tx inspector links, restore button, copy.

## Acceptance
- [ ] Privy login → real World Identity Check → identity created → `<name>.casaazul.eth` resolves live → KYC claim on-chain → LIMITED.
- [ ] Accredited mock → GREEN.
- [ ] Selfie Check personhood → agent creation unlocked.
- [ ] Agent = new wallet, linked (Model A); `bot.<name>.casaazul.eth` resolves agent-registration=1 + reputation.
- [ ] Agent transfers Casa Azul token (GatedERC20) successfully.
- [ ] Revoke person → agent transfer REVERTS with the refusal reason. ENS status flips to REVOKED live.
- [ ] Zero PII on-chain; every mock labeled; ENS resolves live throughout.
