# World ID Testing Documentation

Testing report for PassportKit Node's World ID integration — for the **Selfie Check Beta** and
**Identity Check Beta** (Continuity) tracks. Covers **developer feedback** (SDK/API friction, docs
gaps, setup) and **user feedback** (UX, comprehension, consent, drop-off).

- **Versions:** `@worldcoin/idkit@4.2.1`, `@worldcoin/idkit-core@4.2.2`, `@worldcoin/idkit-server@1.1.1`, `viem@2.55.8`.
- **App:** `app_37a4f42c4b69cebc8b561b84d610d1eb` (World ID 4.0, **Managed**), RP `rp_410e2ce311e7922d`.
- **Actions:** `passportkit-personhood` (Selfie Check), `passportkit-kyc` (Identity Check).
- **Chain:** Ethereum Sepolia. Tested 2026-07-26.

---

## 1. What we built (meaningful use — not generic login)

PassportKit is compliance-credential rails. World ID is our **one real verification**; each World flow
becomes an on-chain **compliance claim** on the user's own identity (Model B), which an EligibilityGate
re-checks to allow/deny access to a gated app (Node PropTech Deal Room), a token transfer, an ENS
record, and a Uniswap hook.

| World flow | Preset | Credential | On-chain claim | Gates |
|---|---|---|---|---|
| **Selfie Check** | `selfieCheckLegacy()` | `face` (live person) | `PROOF_OF_PERSONHOOD` | agent-spawn / personhood-gated access |
| **Identity Check** | `identityCheck({ minimum_age: 18 })` | document-backed attestation | `KYC_VERIFIED` | Deal Room eligibility |

This is **risk / eligibility / compliance** use, not login: a proof that fails or is revoked closes
access across every surface at once (the demo's hero is the **refusal**).

### Data minimization (why the attribute is necessary + how we minimize)

- **Selfie Check:** we need *live personhood* to stop one human spawning many agents / sybils. We request
  the minimum — a live-person credential. We never receive an image or biometric; only a nullifier.
- **Identity Check — why `minimum_age: 18`:** Casa Azul's Deal Room is an **investment** surface, so the
  minimal eligibility signal we need is *legal age to invest*. World ID attests a document-backed
  **18+ yes/no** derived from a verified government document. We deliberately do **not** request
  `full_name`, `document_number`, `issuing_country`, or `nationality` — World attests the predicate and
  we learn nothing else.
- **On-chain:** the claim `data` is `keccak256({ world, kind, nullifier })` — a hash. **Zero PII** is
  stored or written on-chain. The nullifier is a per-app pseudonym, not an identifier.
- **Data erasure (GDPR Art. 17 / LGPD) — sidestepped by design:** because we **never receive or store any
  PII**, there is nothing to erase — the right-to-be-forgotten becomes a non-problem rather than a process.
  This matters doubly on-chain, where data is **immutable** and PII could never be deleted (putting PII
  on-chain would itself be a compliance trap). World ID is what makes this possible: it proves the
  attribute (18+, personhood) without transferring the underlying document data. *(This is
  verification-time privacy — distinct from revocation, which is the enforcement / loss-of-access moment.)*

---

## 2. Developer feedback (SDK / API / docs)

### 2.1 IDKit v4 is a ground-up rewrite — expectation mismatch (HIGH)
Most third-party examples, blog posts, and even some doc snippets still show the **classic** IDKit
(`IDKitWidget`, `verification_level`, `ISuccessResult { merkle_root, nullifier_hash, proof }`, and the
`/api/v2/verify` cloud endpoint). Installing `@worldcoin/idkit@latest` gives **v4**, which is entirely
different: **presets/constraints**, an **RP-signature handshake**, `IDKitResult { responses[] }` with
Groth16 proof arrays, and no `verifyCloudProof`. We initially built the whole backend against the
classic model and had to rewrite it. **Suggestion:** a prominent "you are getting v4" banner on the
IDKit landing page + a classic-vs-v4 comparison table would save hours.

### 2.2 No working phone-free simulator for v4 (HIGH — blocks fast iteration)
The docs say "test with the simulator and set `environment` to `staging`" and point to
`https://simulator.worldcoin.org/`. In practice:
- `simulator.worldcoin.org` shows its own banner: *"This simulator will change with the adoption of
  World ID 4.0"* and behaves like a pre-v4 landing/download page — we could not drive a v4 staging
  proof from it.
- The Developer Portal's **"World ID Sandbox → Install the test build"** link and
  `sandbox.world.org/?download=true` both resolve to the **generic World App** App Store / Play page —
  a dead end for developers expecting a test build or a browser simulator.

Net effect: **the only reliable way to complete a v4 proof was a real phone with the World App on
`production`.** That's a big loop-time hit and blocks CI/headless testing. **Suggestion:** ship a v4
simulator (or clearly label the current one as pre-v4) and make the portal "test build" link actually
deliver a test build.

### 2.3 `environment` values are ambiguous (MEDIUM)
Three values appear across the portal/SDK (`production`, `staging`, `sandbox`) and the relationship to
the "Sandbox" app badge in the portal isn't spelled out. We tried `sandbox` and `staging` before
concluding that, without a working v4 simulator, only `production` + a real World App works. A short
matrix of {app mode in portal} × {`environment` value} × {which client can prove} would remove the
guesswork.

### 2.4 Desktop widget defaulted to deeplink, not QR (HIGH — looked broken)
On desktop the `IDKitRequestWidget` rendered **"Connect your World ID → Open World App"** (a same-device
deeplink) instead of a **QR to scan**. Clicking it navigated to `world.org/?download=true`, which reads
as "the integration is broken." Root cause: the QR vs deeplink choice is purely CSS media-query driven
(`@media (min-width: 1025px)` shows `.idkit-desktop-only` QR; `≤1024px` shows `.idkit-mobile-only`
deeplink). With DevTools docked, our viewport fell **below 1025px**, so we got the mobile deeplink on a
desktop. **Suggestions:** (a) detect a pointer/coarse or UA signal, not just width; (b) expose a prop to
force cross-device (QR) mode; (c) show *both* QR and deeplink above the breakpoint.

### 2.5 Returned credential identifier ≠ documented `CredentialType` (MEDIUM)
`CredentialType` is documented as `"proof_of_human" | "selfie" | "passport" | "mnc"`, but a Selfie
Check proof came back with `identifier: "face"`. We had to widen our accept-list to include `face`.
Aligning the runtime identifier with the documented union (or documenting `face`) would help.

### 2.6 RP-signature model works but is thinly documented (MEDIUM)
`signRequest({ signingKeyHex, action })` from `@worldcoin/idkit-server` → mapping into
`rp_context { rp_id, nonce, created_at, expires_at, signature }` was learnable from the type defs but
not from prose. The field-name mismatch between `signRequest`'s return (`sig`, `createdAt`, `expiresAt`)
and `RpContext` (`signature`, `created_at`, `expires_at`) is an easy foot-gun. A copy-paste backend
example (Node/Nest) for the Managed flow would be ideal.

### 2.7 Identity Check success signal (LOW — once found, clean)
`identity_attested === true` on `IDKitResultV4` is the authoritative "attributes attested" signal, and
it's only present on Identity Check results. This is a nice design; calling it out explicitly in the
Identity Check section (rather than only in a type comment) would help.

### 2.8 EIP-712 domain for downstream claims (LOW — our side, noted for completeness)
World returns only a nullifier (correctly — zero PII), so anchoring it to our own signed claim was
straightforward. No World-side friction here.

---

## 3. User feedback (UX / comprehension / consent / drop-off)

Tester: the app owner's wallet on Sepolia, real World App on iOS, `production`.

### 3.1 Selfie Check — smooth (POSITIVE)
- Scanned the desktop QR with the World App, approved, proof returned in a few seconds. No Orb needed.
- Comprehension was good: "live person, no Orb" is intuitive. Low friction, as advertised.
- **Drop-off risk:** the QR only appeared after we widened the browser window (see 2.4). A first-time
  user with a narrow window would hit the "Open World App" dead end and likely abandon.

### 3.2 Identity Check — clear consent, higher setup bar (MIXED)
- The **`minimum_age: 18`** framing made the consent obvious: the user understood they were proving
  "18+" and nothing else. Data-minimization messaging landed well.
- **Setup drop-off:** Identity Check requires a **document already verified in the World App** (passport
  via NFC). A user who only has a face credential gets no document proof; our strict backend then
  correctly refuses (rather than silently accepting a face proof as KYC). Honest, but it means the
  document flow has a real prerequisite that should be signposted **before** the user starts.
- **Region / document coverage blocked us (HIGH — real tester finding):** our tester tried to enroll a
  **Brazilian passport** in the World App to obtain a document credential and could not — so
  **Identity Check could not be completed at all** for this user, and we could not exercise the ID
  bounty end-to-end with a real document. This is the single biggest blocker we hit: document
  verification coverage is uneven by country, and there is no in-app signal *before* you start telling
  a user from an unsupported region that Identity Check will not work for them. **Suggestions:** (a)
  surface supported document types / countries up front (and in the IDKit error) so the app can fall
  back gracefully; (b) expand document coverage (Brazil); (c) a test/sandbox document credential so
  developers outside supported regions can still build and test the Identity Check flow. Because of
  this we ship Identity Check as a labeled, code-complete path and use **Selfie Check** as the demo's
  real verification (available to our tester).

### 3.3 Cross-device clarity (SUGGESTION)
"You will be redirected to the app, please return to this page once you're done" is fine on mobile but
confusing on desktop (there's no app to return from). A desktop-explicit "Scan this with World App on
your phone" string would reduce confusion.

### 3.4 Consent & privacy (POSITIVE)
Because we surface "Zero PII is stored — only a hash of the nullifier" in the UI and request the
minimum attribute, testers reported trust in the flow. No sensitive data is ever shown or requested.

---

## 4. Setup notes / reproduction

1. Developer Portal → enable **World ID 4.0** → **Managed** (auto RP registration; you keep the signer
   key for proof requests). Copy `app_id`, `rp_id`, signer key. Create two actions.
2. Backend `.env`: `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_ACTION_PERSONHOOD`,
   `WORLD_ACTION_KYC`.
3. `POST /world/request { kind }` → RP-signs via `signRequest` → `{ app_id, action, rp_context }`.
4. Frontend `IDKitRequestWidget` with the config + preset (`selfieCheckLegacy()` /
   `identityCheck({ attributes: [{ type: 'minimum_age', value: 18 }] })`), `environment: 'production'`.
5. `onSuccess(result)` → `POST /world/verify { identity, kind, result }` → strict per-kind validation →
   signs the claim → user submits it to their own Identity (`submitClaim`).
6. **Gotcha:** set an explicit `gas` on the submit tx — an EIP-7702 delegated wallet made viem fall back
   to a ~21M gas limit that exceeded the RPC provider cap (Infura ~16.77M).

## 5. Summary of actionable World feedback (top 6)
1. **Document coverage / region:** support **Brazilian passports** (our tester could not enroll one, which
   blocked Identity Check entirely) and surface supported countries/documents up front + in the IDKit
   error, plus a **test document credential** so devs in unsupported regions can build the flow. *(our #1 blocker)*
2. Ship (or clearly label) a **v4 simulator**; fix the portal "test build" dead-link. *(unblocks dev loop)*
3. Make the desktop widget show a **QR by default** / add a force-cross-device prop. *(looks broken otherwise)*
4. A **classic-vs-v4** migration banner + a **Managed backend** copy-paste example.
5. Document the returned **`face`** identifier and the **`environment`** matrix.
6. Surface **`identity_attested`** and Identity Check attribute semantics in prose, not just types.
