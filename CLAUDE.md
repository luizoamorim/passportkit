# CLAUDE.md — PassportKit Node

Reusable **onchain-identity + compliance-credential kit**. ETHGlobal Lisbon 2026 (Continuity track), forked from the public PassportCreds demo. Compliance credential rails for wallets, apps, **and agents**.

Thesis: *identity before access, compliance before liquidity.* **The demo hero is the REFUSAL (revocation), not the green check.**

---

## Core architecture — SOURCE OF TRUTH (do not drift)

- **Model B ("no privileged writer"):** the user's wallet is the MANAGEMENT key of their own **Identity** (ERC-734 keys + ERC-735 claims). The **ClaimIssuer** only SIGNS claims off-chain (EIP-712); the holder submits their own signed claim. Nobody writes to another's identity. Trust = the signature.
- **EligibilityGate** = the ONE read every surface uses: `isEligible(identity, policyId) → (bool ok, bytes32 reason)`. It loops the trusted issuers (from **IssuerRegistry**), reads the claim off the Identity, and **re-verifies with the ClaimIssuer at read time** (authoritative — the holder can't override a platform decision).
- **Revocation = an issuer-held LATCH** on the ClaimIssuer: `setRevoked(identity, topic, bool)`. While latched, `isClaimValid` is false → the gate refuses AND no fresh claim can land (submitClaim also calls isClaimValid). Only the issuer re-opens. Stronger than by-signature revocation.
- **4 enforcement surfaces** all consume the SAME gate: gated app (Deal Room), **GatedERC20** (transfer gate), **ENS read-through resolver**, **Uniswap v4 hook**.
- **Free-exit principle:** compliance blocks movement to a counterparty (transfer/swap), never your own exit (burn / removeLiquidity). Never trap funds.
- **Zero PII on-chain:** claim `data` = `abi.encode(dataHash, expiresAt, nonce)` — a hash/reference only, never PII. Expiry lives in the signed `data` (enforced by ClaimIssuer.isClaimValid), NOT a separate param.
- **Money moment:** revoke one claim → every surface refuses at once.
- **Chain:** Ethereum Sepolia (L1) — ENS core + Uniswap v4 are co-located there.

## Agent identities (x402) — IN DESIGN
An Identity is not only for a person. A person can spawn an **x402 agent** that gets a **subname of their identity** and acts under the person's credentials: the agent's actions are gated by the PERSON's eligibility (**revoke the person → their agents are blocked too**). This is the "eligibility infrastructure for humans AND agents" story (unlocks World AgentKit + ENS-for-AI-Agents angles). Detailed design: `docs/specs/agent-identity-spec.md` (WIP).

## Contracts (`contracts/`, Foundry)
`Types.sol` (shared vocab) · `Identity` · `IdentityFactory` · `ClaimIssuer` · `IssuerRegistry` · `EligibilityGate` · `GatedERC20` · `ens/PassportResolver` (tenant-aware read-through) · `ens/PassportSubnameRegistrar` · `ComplianceHook` (Uniswap v4).

## Monorepo layout
`contracts/` (Foundry) · `apps/web` (Next 14 App Router — the one demo site) · `apps/api` (NestJS) · `cre/` — npm workspaces are `apps/api`, `apps/web`, `cre`. `apps/hook-demo` and `apps/concierge` are the two standalone node demo servers being folded into `apps/web`; they are retired at the end of `docs/plans/unified-demo-plan.md`.

## Demo runtime (`apps/web`, local anvil only)
- **One world, one file:** `contracts/script/DeployAll.s.sol` deploys the whole stack — both ComplianceHook pools *and* the house treasury on one PoolManager — and writes `apps/web/demo-addresses.json` (gitignored). Resetting one surface no longer wipes the other's contracts.
- `apps/web/src/lib/demo/` — the runtime lifted out of the two standalone `server.js` files. `decode.js` (refusal decoding), `positions.js` (pool logs → liquidity/price/positions), `deciders.js`, `evidence.js`, `x402.js` moved **unchanged**; `chain.ts` (viem clients, actor wallets, `addresses()`, `assertDemo()`, reset/timewarp), `identity.ts` (claim topics, `identityOf`/`isCompliant`, the EIP-712 signer, the revocation latch), `abis.ts` and `tickets.ts` are new.
- `apps/web/src/app/api/demo/**` — the route handlers:
  - `GET /api/demo/world` — the single state read every demo page uses; `POST` takes `{action:'reset'|'timewarp', days?}`.
  - `POST /api/demo/markets` — `{action:'swap'|'liquidity'|'verify'|'revoke', actor, pool?:'deal'|'investor', claim?:'kyc'|'accredited', direction?:'add'|'remove', zeroForOne?, approved?}`. `verify` doubles as restore (it re-opens the latch first); `revoke` with no `claim` revokes every topic.
  - `POST /api/demo/concierge` — `{action:'ticket'|'approve'|'fund'|'grant-mandate'|'revoke-mandate'|'revoke-owner-kyc'|'restore-owner-kyc', …}`; `ticket` takes `{description, amount, category}` and returns the ticket record (`status: paid|pending-approval|executed|rejected|refused|unsettled`).
  - `GET /api/demo/tx/<hash>` — receipt + logs decoded to named events and labelled contracts.
  - `POST /api/demo/vendor/invoice` — the mock plumber speaking x402: 402 challenge without `X-PAYMENT`, `{paid,jobId}` once the referenced tx is verified against the chain.
- **A refusal is a 200, not a 5xx** — the chain saying no is the demo, not an error. Only a malformed request is a 4xx. The two routes report it differently, and a page that gets this wrong shows a refusal as a success:
  - `/api/demo/markets` — a refusal is `{ok:false, reason, wallet, message}` at the top level. **Branch on `ok`.**
  - `/api/demo/concierge` **ticket** — always `{ok:true, ticket}` when the chain refused (`ticket.status:'refused'`, `ticket.refusal:{reason, wallet, message, source?}`), but `{ok:false, status:'unsettled', ticket}` when the swap landed and only the vendor settlement failed. **Branch on `ticket.status` / `ticket.refusal`, never on `ok`.** Every other concierge action is flat `{ok, txHashes}` like markets.
  - Reason codes: `MISSING_KYC`, `MISSING_ACCREDITED`, `OWNER_NOT_COMPLIANT`, `MANDATE_REVOKED`, `OVER_PER_TX_CAP`. `HouseTreasury.NotAgent()` carries none, so rail 2 refusals fall back to the treasury's standing view and are marked `source:'treasury'`.
- **Gated on `DEMO_MODE=true`:** every handler calls `assertDemo()` first and returns 403 otherwise. The anvil actor private keys live only in `chain.ts` (server bundle) — never in a `NEXT_PUBLIC_*` var, and never imported from a client component.
- Tests: `npm test --workspace=apps/web` runs `node --test test/demo/`. `src/lib/demo/` and `test/` each carry a one-line `package.json` (`{"type":"module"}`) so node loads the ESM libs directly without making the whole Next app ESM.

## Conventions
- Solidity `^0.8.24` (solc 0.8.24), **Apache-2.0**, OpenZeppelin v5 (`@openzeppelin/contracts/...`), forge-std. **ASCII-only in string literals** (solc rejects unicode).
- Run the contract tests with `forge test` (the legacy PassportCreds contracts + tests were removed).
- Specs: `docs/specs/`. Vibe-coding prompts: `docs/prompts/`.
- **React is pinned repo-wide to 18.3.1** by the root `overrides` — `apps/web` (Next 14) breaks at prerender if the React 19 that `apps/api`'s `prisma` pulls in wins the hoist. npm never writes `overrides` into `package-lock.json`, so editing them is invisible to `npm install`: you must also drop the stale `react`/`react-dom` lock entries (or the whole lockfile) and re-resolve. Check with `node -p "require('./node_modules/react/package.json').version"` → `18.3.1`.

## Git workflow — IMPORTANT (multiple agents work this repo)
- **Multiple Claude agents run CONCURRENTLY on this repo.** ALWAYS run `git branch --show-current` right before committing/pushing — the branch can change under you.
- Flow: `feature/<lane>-<thing>` → PR → `develop` → (milestone) `main`. Never commit directly to `develop`/`main`.
- **Commit locally; do NOT push automatically** — the human reviews before push.
- AI code reviews (Copilot) are **advisory**: apply genuine fixes, reject architecture drift. This file + `docs/specs/` are the source of truth.
- Never add `Co-Authored-By` lines to commit messages.

## Boundaries
- This repo is **new, public** code only. Never bring in private production code; keep internal company/contract names out of committed files.
- World ID = real personhood. KYC / accredited = **labeled mocks**. No hard-coded demo values (ENS resolves live).
