# Deploy — Frontend on Vercel, Backend + Postgres on Railway

The hero demo runs on **real Sepolia**. Frontend (Next.js `apps/web`) → **Vercel**.
Backend (NestJS `apps/api`, full AppModule incl. HeroModule) + **Postgres** → **Railway**.

> Deploy order matters (the two URLs reference each other):
> **1) Railway backend → get its URL → 2) Vercel frontend (points at it) → get its URL →
> 3) set that URL as `CORS_ORIGIN` on Railway + add it to Privy allowed domains.**

---

## 1. Railway — backend + Postgres

Railway reads `railway.toml` (repo root) → builds `apps/api/Dockerfile` (runs
`prisma migrate deploy && node dist/main`). The full API includes `/hero/*`, `/world/*`,
`/identity/*`, `/issuer/*`.

**Steps**
1. New Project → **Provision PostgreSQL** (plugin).
2. **New Service → Deploy from GitHub repo** → pick `luizoamorim/passportkit`, branch `main`
   (service root = repo root; it auto-detects `railway.toml`).
3. Add the env vars below. For `DATABASE_URL` use the Railway reference
   `${{Postgres.DATABASE_URL}}`. `PORT` is injected by Railway automatically.
4. Deploy → copy the public URL (e.g. `https://passportkit-api.up.railway.app`).

**Env vars (Railway → the API service)**
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
CHAIN_ID=11155111
RPC_URL=<your Sepolia RPC (Alchemy)>
DEMO_MODE=true                         # enables Selfie-Check->KYC override + mock accredited + revoke
CORS_ORIGIN=https://<your-vercel-app>.vercel.app   # set after step 2 (comma-separate for previews)

# Contracts (Sepolia — docs/DEPLOYMENTS.md)
CLAIM_ISSUER_ADDRESS=0x56F97734cC4d80af950538eAA6976398b5E58Fa9
IDENTITY_FACTORY_ADDRESS=0x23504699EAcc1842d01998C0D57C53a2CF1638A0
PASSPORT_RESOLVER_ADDRESS=0x14a83c7aE0667e90ff3863C6eF12539F67e4Cd58
SCORE_REGISTRY_ADDRESS=0x010c452FEC23669Be2D076Efe0CAEEb28c82Aa6E
GATED_ERC20_ADDRESS=0xe3a29101263567c400A0d4d47C52912d3Ed0a08d
ENS_PARENT_NAME=casaazul.eth

# Keys (SECRET — controller/issuer is 0xEc98; keep them a dev/throwaway wallet)
ISSUER_SIGNER_PRIVATE_KEY=0x...
AGENT_PRIVATE_KEY=0x...                 # same 0xEc98 key; needs Sepolia ETH (gas drip + mint)

# World ID v4 (Developer Portal)
WORLD_APP_ID=app_37a4f42c4b69cebc8b561b84d610d1eb
WORLD_RP_ID=rp_410e2ce311e7922d
WORLD_RP_SIGNING_KEY=0x...              # SECRET
WORLD_ACTION_PERSONHOOD=passportkit-personhood
WORLD_ACTION_KYC=passportkit-kyc
```

> ⚠️ The `0xEc98` wallet must hold **Sepolia ETH** — it drips gas to new user/agent wallets
> and mints Casa Azul tokens. Top it up before demoing.

---

## 2. Vercel — frontend

**Steps**
1. Import `luizoamorim/passportkit`.
2. **Root Directory = `apps/web`**. Framework preset: **Next.js** (auto).
   Leave build/install commands default — Vercel installs the npm workspace at the repo
   root, so the `react@18` override in `package.json`/`package-lock.json` applies (the
   build was failing on duplicate React before that fix).
3. Env vars (below). Deploy → copy the URL.

**Env vars (Vercel)**
```
NEXT_PUBLIC_API_URL=https://<your-railway-api>.up.railway.app
NEXT_PUBLIC_PRIVY_APP_ID=<your Privy app id>
NEXT_PUBLIC_WORLD_ENV=production
```

---

## 3. Wire the two together
1. Set `CORS_ORIGIN` on Railway to the Vercel URL → redeploy the API.
2. **Privy dashboard** → add the Vercel domain to allowed origins/domains, and confirm
   **Sepolia** is enabled for the app.
3. Open `https://<vercel-app>/hero` and run the flow.

## Notes
- The `/markets` and `/concierge` demo routes need a local anvil (`make demo`) — they are
  NOT part of the Vercel deploy; the shell hides them when `/api/demo/world` 403s. `/hero`,
  `/passport`, `/deal-room` and the landing work against Sepolia via the Railway API.
- `next build` runs lint separately (`eslint.ignoreDuringBuilds`) due to a pinned
  eslint-plugin incompatibility; run `npm run lint` locally if needed.
