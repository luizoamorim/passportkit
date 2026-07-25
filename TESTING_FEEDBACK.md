# World ID MVP testing feedback

- Developer setup: IDKit Request Widget needs an RP ID and a server-only RP signing key in addition to the public app ID/action. Missing values return a clear configuration error instead of a fake success.
- Staging vs production: this MVP always uses IDKit `environment="staging"`; use the World ID Simulator, not a production World App action.
- Errors: cancelling surfaces “World ID verification was cancelled”; backend/network failures stay in the card and do not mark a claim verified.
- Mock mode: `DEMO_MODE=true` creates deterministic in-memory identities and status only. It never says an on-chain write occurred.
- Initial UX: the wallet-first flow is easy to follow; the remaining friction is that a real Model B transaction requires a configured identity/issuer deployment and a signing-capable wallet.
- Authentication: the landing page uses Privy's headless `useLoginWithEmail` OTP flow and its configured wallet login selector. Privy logout is awaited; app-scoped session state is cleared and stale injected-wallet auto-restore is suppressed until the user explicitly connects again.
- Selfie Check: staging Selfie Check is a separate v3 Face/legacy proof path (`selfieCheckLegacy`, `allow_legacy_proofs=true`) and updates only `PROOF_OF_PERSONHOOD`.
- Identity Check: document-backed `identityCheck` uses the separate v4 path and updates only `KYC_VERIFIED`.
