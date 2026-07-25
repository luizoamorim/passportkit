# World ID MVP

PassportKit keeps World ID proofs server-verified. The frontend has only public `NEXT_PUBLIC_WORLD_APP_ID` and `NEXT_PUBLIC_WORLD_ACTION`; `WORLD_RP_SIGNING_KEY` remains in `apps/api/.env`.

## Independent checks

- **Selfie Check Beta** uses `selfieCheckLegacy`, `allow_legacy_proofs=true`, and staging QR/deep-link hand-off. Its World ID 3.0 Face proof maps to `PROOF_OF_PERSONHOOD`, never `KYC_VERIFIED`.
- **Identity Check Beta** uses `identityCheck` with passport document type and minimum age 18. Its World ID 4.0 document proof maps to `KYC_VERIFIED`.

Both proofs are forwarded unchanged to the backend verification route. In `DEMO_MODE=true`, a successful real staging verification updates in-memory status only; no on-chain claim is represented as written.

## Run

```powershell
npm run start --workspace=apps/api
NEXT_IGNORE_INCORRECT_LOCKFILE=1 npm run dev --workspace=apps/web -- --port 3003
```

Use `http://localhost:3003`. The Privy email OTP and supported-wallet selector require `NEXT_PUBLIC_PRIVY_APP_ID` in `apps/web/.env.local`.
