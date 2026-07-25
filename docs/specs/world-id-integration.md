# World ID Integration — Build Plan (roteiro)

**Branch:** `feature/world-id`. Goal: World ID is the demo's **real** verification (KYC + personhood),
with **two flows** — **Self Check (selfie)** and **ID Verification (document)**. Accredited stays a
labeled mock. Zero PII on-chain (IDKit returns a cryptographic proof, we store only a hash).

> **IDKit v4.** We use `@worldcoin/idkit` **v4.x** (the version the World docs recommend). v4 is a
> ground-up rewrite: **presets/constraints** instead of `verification_level`, an **RP-signature
> handshake** (the backend signs each proof request), and Groth16 proofs (`WorldIDVerifier.sol`-
> compatible) instead of the old `merkle_root/nullifier_hash/proof` triple + v2 cloud verify.

> Drop-in: the World handler is the real evidence source for a claim; the rest of the pipeline
> (issuer signs EIP-712 -> user submits via `Identity.submitClaim` -> gate re-verifies) is UNCHANGED.
> Contracts need **zero changes** — the 3 topics are already trusted on the deployed IssuerRegistry.

## Mapping (2 World flows -> 2 real claims)
| World flow | v4 preset | World credential | Our topic | Result |
|---|---|---|---|---|
| **Self Check** (selfie / face) | `selfieCheckLegacy()` | `selfie` | `PROOF_OF_PERSONHOOD` | real |
| **ID Verification** (document) | `passport()` | `passport` / `mnc` / `eid` | `KYC_VERIFIED` | **real** |
| — | — | — | `ACCREDITED_INVESTOR` | mock (labeled) |

`proofOfHuman()` (Orb-backed 4.0) is a stretch upgrade for the Self Check flow. Selfie Check is in
preview on the World side — enable it on the app in the Developer Portal.

## Keys (Developer Portal — developer.worldcoin.org, NOT a booth)
- `WORLD_APP_ID` (`app_…`), `WORLD_RP_ID` (`rp_…`), `WORLD_RP_SIGNING_KEY` (RP ECDSA signing key hex).
- `WORLD_ACTION_PERSONHOOD` + `WORLD_ACTION_KYC` (one action id per flow).
- Enable **Selfie Check** (preview) + **document** credentials on the app.

## Deployed context (Sepolia, see docs/DEPLOYMENTS.md)
ClaimIssuer `0x56F97734cC4d80af950538eAA6976398b5E58Fa9` · IdentityFactory `0x23504699EAcc1842d01998C0D57C53a2CF1638A0`
· agent/signer `0xEc98…f2A4`. `PROOF_OF_PERSONHOOD` + `KYC_VERIFIED` already `setTrusted` on IssuerRegistry.

---

## Phase 1 — Backend: `POST /world/request` + `POST /world/verify`  ✅ DONE

Reuses the existing **`IssuerSigningService.signClaim`** (apps/api/src/issuer/) — did NOT rebuild signing.
v4 needs TWO endpoints (the RP-signature handshake), both in `apps/api/src/world/`:

- **`world.service.ts`**
  - `buildRequest(kind)` -> `{ app_id, action, rp_context, mock }`. RP-signs the request with
    `signRequest({ signingKeyHex, action })` from **`@worldcoin/idkit-server`** and maps the result into
    the v4 `RpContext` (`rp_id, nonce, created_at, expires_at, signature`).
  - `verifyResult(kind, result)` -> validates the `IDKitResult` structurally (right credential present)
    and extracts ONLY the `nullifier` (or `session_nullifier[0]`) — a per-user pseudonym, NEVER PII.
    Tolerant of V3 / V4 / Session response shapes.
  - Graceful-degrade: if `WORLD_APP_ID` / `WORLD_RP_ID` / `WORLD_RP_SIGNING_KEY` are unset, `DEMO_MODE`
    returns a labeled mock so the demo runs before the Developer Portal keys are wired.
  - **Production step (documented, not built):** full cryptographic verification of the Groth16 proof is
    done **on-chain by `WorldIDVerifier.sol`** (v4 proofs are arrays compatible with it). The backend
    does structural validation + the RP-signature binding; the on-chain verifier is the trust anchor.
- **`world.controller.ts`**
  - `POST /world/request { kind }` -> `buildRequest`. `kind ∈ {'selfie','document'}`.
  - `POST /world/verify { identity, kind, result }` -> `verifyResult`, then
    `dataHash = keccak256(toHex(JSON.stringify({ world:true, kind, nullifier })))` (sanitized, no PII),
    `nonce = randomBytes(32)`, `expiresAt = now + 365d`, `signing.signClaim(...)` ->
    returns `{ signature, data, issuer, topic, topicName, credential, mock }`.
  - topic = kind==='selfie' ? PROOF_OF_PERSONHOOD : KYC_VERIFIED (from `issuer/claim-topics.ts`).
  - NOT DEMO_MODE-gated: a real World proof IS the authorization (mock only when keys are unset).
- **`world.module.ts`** — controller + service; `imports: [IssuerModule]` (exports IssuerSigningService).
- **`app.module.ts`** — `WorldModule` registered.
- **.env** (api): `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_ACTION_PERSONHOOD`,
  `WORLD_ACTION_KYC` (+ existing `ISSUER_SIGNER_PRIVATE_KEY`, `CLAIM_ISSUER_ADDRESS`).
- dep: `@worldcoin/idkit-server`.

Test: `world.service.spec` — DEMO_MODE buildRequest/verifyResult, session_nullifier extraction, and the
no-silent-bypass guard outside DEMO_MODE. ✅ passing.

## Phase 2 — Frontend: dual IDKit v4 card

- `apps/web/src/components/world/WorldVerifyCard.tsx`
  - Two actions rendered as two buttons/cards: **Self Check** and **ID Verification**.
  - For each: `POST /world/request { kind }` -> get `{ app_id, action, rp_context }`, then open
    **`IDKitRequestWidget`** (`@worldcoin/idkit` v4) with `app_id`, `action`, `rp_context`,
    `allow_legacy_proofs: true`, and the matching **preset** (`selfieCheckLegacy()` / `passport()`),
    controlled via `open` / `onOpenChange`.
  - `onSuccess(result)` -> `POST /world/verify { identity, kind, result }` -> get
    `{ signature, data, issuer, topic }` -> `Identity.submitClaim(topic, issuer, sig, data)` from the
    **user wallet** (viem walletClient over Privy / window.ethereum).
  - Resolve the user's Identity via `IdentityFactory.identityOfWallet(wallet)` (viem read).
- Wire into a new **`/verify`** page (recommended for demo clarity).
- .env (web): `NEXT_PUBLIC_API_URL` (already used by `lib/api.ts`). The app_id/action/rp_context all
  come from the backend `/world/request`, so no World secrets live in the frontend.
- dep: `@worldcoin/idkit` (v4).

## Phase 3 — Show it
- After a World verify, the user's identity has the real claim -> `EligibilityGate.isEligible` flips.
- Optional: bind the verified identity to an ENS subname (WireEnsDemo pattern) so `name.casaazul.eth`
  resolves the real World-backed status.

## Acceptance criteria
- [x] Backend v4 handshake: `/world/request` RP-signs; `/world/verify` validates + signs a claim.
- [ ] Two working World flows in the UI; each returns a proof the backend validates + signs a claim.
- [ ] Self Check -> PROOF_OF_PERSONHOOD; ID Verification -> KYC_VERIFIED (both real, user-submitted, Model B).
- [ ] Accredited remains a labeled mock.
- [x] No PII on-chain (only a hash of {world,kind,nullifier}).
- [x] Works before keys via DEMO_MODE fallback; real once WORLD_APP_ID + RP key + actions are set.

## Open items (Developer Portal)
- `WORLD_APP_ID` + `WORLD_RP_ID` + `WORLD_RP_SIGNING_KEY` + action ids (personhood, kyc).
- Enable **Selfie Check** (preview) + **document** credentials on the app.
- Decide screen: `/verify` new page vs section on `/passport` (recommend `/verify`).
- Production: deploy / point at `WorldIDVerifier.sol` for on-chain Groth16 proof verification.

## Execution order
1. ✅ Backend Phase 1 (world.service + controller + module + app.module + .env) — tsc + spec green.
2. Frontend Phase 2 (WorldVerifyCard + /verify page) — tsc + next build.
3. Wire into the demo + optional ENS bind.
Commit per phase; PR `feature/world-id` -> develop.
