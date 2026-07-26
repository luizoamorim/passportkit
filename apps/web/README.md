# apps/web — PassportKit demo site

The Next.js (App Router) frontend and the **one demo site**. A visitor connects a wallet once on the landing page and walks all four enforcement surfaces — one wallet, one chain, all the way through. See the [root README](../../README.md) for the full architecture.

## Routes

| Route | What it shows |
|---|---|
| `/` | Landing — connect a wallet, walk the four steps. |
| `/passport` | Get verified: create an Identity, run World ID (personhood → **LIMITED**, KYC → **GREEN**), the user submits each claim, the ENS name resolves live. |
| `/deal-room` | The gated app — asks the `EligibilityGate`, never for a document. |
| `/markets` | Uniswap v4 pools gated by the same gate; non-compliant swaps revert `NotCompliant(wallet, reason)`, exit is always free. |
| `/concierge` | A house agent (a linked wallet) spending a mandate that holds only while its human owners stay compliant. |
| `/hero` | Standalone ENSIP-25 agent-identity card. |

`/passport` and `/deal-room` are the product pages and work against Sepolia. `/markets` and `/concierge` need the local demo runtime (below).

## The demo runtime

The demo's server-side logic lives in route handlers under `src/app/api/demo/**` (`world`, `markets`, `concierge`, `tx/[hash]`, `vendor/invoice`) over the viem libs in `src/lib/demo/` (`deciders` · `evidence` · `x402` · `decode` · `positions`). Every handler calls `assertDemo()` first and answers **403 unless `DEMO_MODE=true`**, so the anvil actor keys stay server-side and never reach a `NEXT_PUBLIC_*` var.

## Run

```bash
# from the repo root — the full one-world demo (anvil + deploy + site on :3003)
make demo

# or standalone dev against a configured backend/chain
npm run dev                          # Next dev on :3000
npm run dev:web                      # equivalently, from the repo root
```

## Environment

Two **non-interchangeable** templates:

- **`env.example`** — the local demo (`DEMO_MODE`, `RPC_URL`, `EXPLORER_URL`, the anvil actor keys, `NEXT_PUBLIC_PRIVY_APP_ID`). Copy to `.env.local` for `make demo`.
- **`.env.example`** — a hosted Sepolia deployment of the product pages (`NEXT_PUBLIC_*` gate / World / ENS addresses). Does **not** turn the demo runtime on.

> **`DEMO_MODE=true` lets anyone who can reach the server sign with the anvil keys — it belongs on a laptop, never on a deployment.**

## Test

```bash
npm test               # node:test over test/demo/ (decider rules, x402, evidence hashing, revert decoding, positions)
```
