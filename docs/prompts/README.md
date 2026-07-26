# prompts/ — vibe-coding prompts (spec-driven)

> The prompts we feed the AI **in-event** to generate each piece from the specs. These ship in the repo (ETHGlobal requires specs + prompts to be included — "judges need to see how you directed the AI").
>
> **How to use:** open the relevant `specs/*.md` alongside the prompt, run the prompt, then **commit incrementally** and review. Never bulk-drop. Attribute AI use per file in `AI-USAGE.md`.

Order: `01-contracts` → `02-backend` → `03-frontend`.

- `01-contracts.md` — the identity + gate + surface contracts (Identity, IdentityFactory, ClaimIssuer, IssuerRegistry, EligibilityGate, GatedERC20, ENS resolver + registrar) and their Foundry tests. The repo now holds **14 deployable contracts / 15 `.sol` files** (incl. the Uniswap v4 hook and the agent/concierge layer), covered by **132 tests across 15 suites**.
- `02-backend.md` — issuer signing service + adapt the reused NestJS modules.
- `03-frontend.md` — adapt the reused dashboard + gated app to the gate + ENS.
