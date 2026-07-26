.PHONY: help up up-testnet down api cre web db migrate ngrok logs \
        test-kyc test-green test-red status stop reset-db \
        build-cre env-check deploy-testnet deploy-local anvil \
        demo demo-chain demo-deploy demo-web demo-stop demo-explorer \
        hero hero-stop

# ─── Config ───────────────────────────────────────────────────────────────────

WALLET        ?= 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
API_URL       := http://localhost:3001
CRE_URL       := http://localhost:3002
API_LOG       := /tmp/passport-api.log
CRE_LOG       := /tmp/passport-cre.log
WEB_LOG       := /tmp/passport-web.log
NGROK_LOG     := /tmp/passport-ngrok.log
ANVIL_LOG     := /tmp/passport-anvil.log

# ─── The unified demo ─────────────────────────────────────────────────────────
# Both ports are overridable so a second copy of the repo can run its own world
# without touching the one already on :8545 —
#   make demo RPC_PORT=8546 WEB_PORT=3010

RPC_PORT        ?= 8545
WEB_PORT        ?= 3003
DEMO_RPC        := http://127.0.0.1:$(RPC_PORT)
DEMO_URL        := http://localhost:$(WEB_PORT)
# All keyed by the port they describe, so `make demo RPC_PORT=8546 WEB_PORT=3010`
# writes its own files instead of overwriting the first world's.
DEMO_ANVIL_LOG  := /tmp/passport-demo-anvil-$(RPC_PORT).log
DEMO_DEPLOY_LOG := /tmp/passport-demo-deploy-$(RPC_PORT).log
DEMO_WEB_LOG    := /tmp/passport-demo-web-$(WEB_PORT).log
# Written only when `demo-chain` starts an anvil itself — `demo-stop` kills the
# chain only if this says the demo owns it. Keyed by port so two demos on two
# ports do not claim each other's node.
DEMO_ANVIL_PID  := /tmp/passport-demo-anvil-$(RPC_PORT).pid

# The canonical CREATE2 deployer the v4 hook address mining needs. Anvil ships
# it at genesis but anvil_reset drops it, so a demo re-run on an already-reset
# chain re-etches it rather than failing with "missing CREATE2 deployer".
CREATE2_ADDR := 0x4e59b44847b379578588920cA78FbF26c0B4956C
CREATE2_CODE := 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3

# ─── Help ─────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  PassportCreds by Node — dev commands"
	@echo ""
	@echo "  The demo"
	@echo "    make demo          — anvil + one deployed world + the site on :$(WEB_PORT)"
	@echo "                         (override with RPC_PORT=… WEB_PORT=…)"
	@echo "    make demo-stop     — stop that site, and its anvil if make demo started it"
	@echo "    make demo-explorer — Otterscan on :5100 against the demo chain"
	@echo ""
	@echo "  The hero flow (real Sepolia)"
	@echo "    make hero          — DB-free API on :3001 + web on :3000 → /hero"
	@echo "    make hero-stop     — stop both"
	@echo ""
	@echo "  Setup"
	@echo "    make env-check     — verify .env files exist"
	@echo "    make db            — start PostgreSQL (podman)"
	@echo "    make anvil         — start local EVM node on :8545"
	@echo "    make deploy-local  — deploy contracts to local Anvil"
	@echo "    make migrate       — run Prisma migrations"
	@echo "    make build-cre     — build CRE TypeScript"
	@echo ""
	@echo "  Start services"
	@echo "    make api           — start NestJS API on :3001"
	@echo "    make cre           — start CRE server on :3002"
	@echo "    make web           — start Next.js frontend on :3000"
	@echo "    make ngrok         — expose :3001 via ngrok (set NGROK_URL after)"
	@echo "    make up            — start db + anvil + api + cre + web (local)"
	@echo "    make up-testnet    — start db + api + cre + web (Base Sepolia)"
	@echo ""
	@echo "  Test flows (WALLET=0x... make test-kyc)"
	@echo "    make test-kyc      — KYC approved → passport = LIMITED"
	@echo "    make test-green    — KYC + Accreditation → passport = GREEN"
	@echo "    make test-red      — KYC failed → passport = RED"
	@echo "    make status        — show current passport state"
	@echo ""
	@echo "  Logs"
	@echo "    make logs          — tail all service logs"
	@echo ""
	@echo "  Stop / reset"
	@echo "    make stop          — kill API, CRE, frontend, ngrok"
	@echo "    make down          — stop and remove postgres container"
	@echo "    make reset-db      — wipe DB + re-migrate (DESTROYS DATA)"
	@echo ""
	@echo "  Testnet"
	@echo "    make deploy-testnet — deploy contracts to Base Sepolia"
	@echo ""

# ─── Setup ────────────────────────────────────────────────────────────────────

env-check:
	@test -f apps/api/.env   || (echo "ERROR: apps/api/.env missing — copy from apps/api/.env.example" && exit 1)
	@test -f cre/.env        || (echo "ERROR: cre/.env missing — copy from cre/.env.example" && exit 1)
	@test -f apps/web/.env.local || (echo "WARNING: apps/web/.env.local missing — copy from apps/web/.env.example"; true)
	@echo "✓ .env files OK"

# Replaces the chain on :8545 only. This used to `pkill -f "anvil"`, which also
# killed a `make demo` chain running on some other port.
anvil:
	@echo "→ Starting Anvil (local EVM node) on :8545 (log: $(ANVIL_LOG))"
	@lsof -ti:8545 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
	@anvil > $(ANVIL_LOG) 2>&1 &
	@sleep 2
	@curl -sf -X POST http://localhost:8545 \
	  -H "Content-Type: application/json" \
	  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null \
	  && echo "✓ Anvil up on :8545" || echo "✗ Anvil failed — check $(ANVIL_LOG)"

db:
	@echo "→ Starting PostgreSQL..."
	@podman compose up -d postgres
	@echo "✓ PostgreSQL up on :5433"

migrate:
	@echo "→ Running Prisma migrations..."
	@DB_URL=$$(grep '^DATABASE_URL' apps/api/.env | cut -d= -f2- | tr -d '"'); \
	 cd apps/api && DATABASE_URL="$$DB_URL" npx prisma migrate deploy
	@echo "✓ Migrations done"

build-cre:
	@echo "→ Building CRE..."
	@npm run build --workspace=cre
	@echo "✓ CRE built"

# ─── Start services (background) ──────────────────────────────────────────────

api:
	@echo "→ Starting NestJS API on :3001 (log: $(API_LOG))"
	@lsof -ti:3001 | xargs kill -9 2>/dev/null || true
	@cd apps/api && npx ts-node --transpile-only src/main.ts > $(API_LOG) 2>&1 &
	@sleep 3
	@curl -sf $(API_URL)/passport/$(WALLET) > /dev/null && echo "✓ API up" || echo "✗ API failed to start — check $(API_LOG)"

cre:
	@echo "→ Starting CRE server on :3002 (log: $(CRE_LOG))"
	@lsof -ti:3002 | xargs kill -9 2>/dev/null || true
	@cd cre && env $$(grep -v '^#' .env | grep '=' | xargs) node dist/server.js > $(CRE_LOG) 2>&1 &
	@sleep 2
	@curl -sf $(CRE_URL)/health > /dev/null && echo "✓ CRE up" || echo "✗ CRE failed to start — check $(CRE_LOG)"

web:
	@echo "→ Starting Next.js on :3000 (log: $(WEB_LOG))"
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@cd apps/web && npm run dev > $(WEB_LOG) 2>&1 &
	@sleep 5
	@curl -sf http://localhost:3000 > /dev/null && echo "✓ Frontend up" || echo "✗ Frontend not yet ready — check $(WEB_LOG)"

# ─── The hero flow (real Sepolia, DB-free) ─────────────────────────────────────
# The guided /hero journey: World ID + identity + live ENS + agent + money moment.
# No Postgres/anvil — a DB-free API (hero-main.ts) + the web app, both against
# Sepolia (reads apps/api/.env: CHAIN_ID=11155111, DEMO_MODE=true, World + agent keys).
HERO_API_LOG := /tmp/passport-hero-api.log
HERO_WEB_LOG := /tmp/passport-hero-web.log

hero:
	@echo "→ Hero flow (Sepolia): DB-free API on :3001 + web on :3000"
	@lsof -ti:3001 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@cd apps/api && npx ts-node-dev --respawn --transpile-only -r tsconfig-paths/register src/hero-main.ts > $(HERO_API_LOG) 2>&1 &
	@cd apps/web && npm run dev > $(HERO_WEB_LOG) 2>&1 &
	@sleep 10
	@curl -sf -X POST http://localhost:3001/world/request -H "Content-Type: application/json" -d '{"kind":"document"}' > /dev/null \
		&& echo "✓ Hero API up (:3001)" || echo "✗ API — check $(HERO_API_LOG)"
	@curl -sf http://localhost:3000/hero > /dev/null \
		&& echo "✓ Hero web up → http://localhost:3000/hero" || echo "✗ web — check $(HERO_WEB_LOG)"

hero-stop:
	@lsof -ti:3001 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@echo "✓ Hero stopped"

ngrok:
	@echo "→ Starting ngrok tunnel for :3001"
	@pkill -f "ngrok http" 2>/dev/null || true
	@ngrok http 3001 --log stdout > $(NGROK_LOG) 2>&1 &
	@sleep 3
	@NGROK_URL=$$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(next((x['public_url'] for x in t if x['public_url'].startswith('https')), 'not ready'))"); \
	 echo "✓ ngrok tunnel: $$NGROK_URL"; \
	 echo ""; \
	 echo "  Set this in apps/api/.env:"; \
	 echo "    NGROK_URL=$$NGROK_URL"; \
	 echo ""; \
	 echo "  AI Attester webhook URL:"; \
	 echo "    $$NGROK_URL/webhooks/ai-attester"

# ─── Start everything ─────────────────────────────────────────────────────────

up: build-cre
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  PassportCreds by Node — starting up (local)"
	@echo "══════════════════════════════════════════"
	@echo ""
	@$(MAKE) db
	@sleep 2
	@$(MAKE) anvil
	@sleep 2
	@$(MAKE) deploy-local
	@$(MAKE) api
	@$(MAKE) cre
	@$(MAKE) web
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  All services started"
	@echo "  Anvil:    http://localhost:8545"
	@echo "  API:      http://localhost:3001"
	@echo "  CRE:      http://localhost:3002"
	@echo "  Frontend: http://localhost:3000"
	@echo ""
	@echo "  Run: make ngrok   to expose webhook"
	@echo "  Run: make logs    to tail all logs"
	@echo "══════════════════════════════════════════"
	@echo ""

up-testnet: build-cre
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  PassportCreds by Node — starting up (Base Sepolia)"
	@echo "══════════════════════════════════════════"
	@echo ""
	@$(MAKE) db
	@sleep 2
	@$(MAKE) api
	@$(MAKE) cre
	@$(MAKE) web
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  All services started (testnet mode)"
	@echo "  Network:  Base Sepolia (chain 84532)"
	@echo "  API:      http://localhost:3001"
	@echo "  CRE:      http://localhost:3002"
	@echo "  Frontend: http://localhost:3000"
	@echo ""
	@echo "  Run: make ngrok   to expose webhook"
	@echo "  Run: make logs    to tail all logs"
	@echo "══════════════════════════════════════════"
	@echo ""

# ─── Test flows ───────────────────────────────────────────────────────────────

test-kyc:
	@echo ""
	@echo "── Test: KYC/AML approved → passport = LIMITED ──"
	@VID=$$(curl -sf -X POST $(API_URL)/verification/start \
	  -H "Content-Type: application/json" \
	  -d '{"walletAddress":"$(WALLET)","claimType":"KYC_AML_VERIFIED"}' \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['verificationId'])"); \
	echo "  verificationId: $$VID"; \
	curl -sf -X POST "$(API_URL)/verification/$$VID/mock-ai-result" \
	  -H "Content-Type: application/json" -d '{"approved":true}' > /dev/null; \
	echo "  AI result injected. Waiting for CRE..."; \
	sleep 4; \
	STATUS=$$(curl -sf $(API_URL)/passport/$(WALLET) \
	  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])"); \
	echo "  passport status: $$STATUS"; \
	[ "$$STATUS" = "LIMITED" ] && echo "  ✓ PASS" || echo "  ✗ FAIL — expected LIMITED"

test-green: test-kyc
	@echo ""
	@echo "── Test: Accredited Investor → passport = GREEN ──"
	@VID=$$(curl -sf -X POST $(API_URL)/verification/start \
	  -H "Content-Type: application/json" \
	  -d '{"walletAddress":"$(WALLET)","claimType":"ACCREDITED_INVESTOR"}' \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['verificationId'])"); \
	echo "  verificationId: $$VID"; \
	curl -sf -X POST "$(API_URL)/verification/$$VID/mock-ai-result" \
	  -H "Content-Type: application/json" -d '{"approved":true}' > /dev/null; \
	echo "  AI result injected. Waiting for CRE..."; \
	sleep 4; \
	STATUS=$$(curl -sf $(API_URL)/passport/$(WALLET) \
	  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])"); \
	echo "  passport status: $$STATUS"; \
	[ "$$STATUS" = "GREEN" ] && echo "  ✓ PASS" || echo "  ✗ FAIL — expected GREEN"

test-red:
	@echo ""
	@echo "── Test: KYC failed → passport = RED ──"
	@WALLET2=0x70997970C51812dc3A010C7d01b50e0d17dc79C8; \
	VID=$$(curl -sf -X POST $(API_URL)/verification/start \
	  -H "Content-Type: application/json" \
	  -d "{\"walletAddress\":\"$$WALLET2\",\"claimType\":\"KYC_AML_VERIFIED\"}" \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['verificationId'])"); \
	echo "  verificationId: $$VID"; \
	curl -sf -X POST "$(API_URL)/verification/$$VID/mock-ai-result" \
	  -H "Content-Type: application/json" -d '{"approved":false}' > /dev/null; \
	echo "  AI result injected (failed). Waiting for CRE..."; \
	sleep 4; \
	STATUS=$$(curl -sf $(API_URL)/passport/$$WALLET2 \
	  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])"); \
	echo "  passport status: $$STATUS"; \
	[ "$$STATUS" = "RED" ] && echo "  ✓ PASS" || echo "  ✗ FAIL — expected RED"

status:
	@echo ""
	@echo "── Passport state for $(WALLET) ──"
	@curl -sf $(API_URL)/passport/$(WALLET) | python3 -c "\
import sys, json; \
d = json.load(sys.stdin); \
print(f\"  status:          {d['status']}\"); \
print(f\"  canAccessDealRoom: {d['canAccessDealRoom']}\"); \
print(f\"  canInvest:        {d['canInvest']}\"); \
[print(f\"  claim: {c['claimType']} = {c['status']}\") for c in d.get('claims', [])]; \
[print(f\"  tx:    {t['contractName']} — {t['transactionHash'][:20]}...\") for t in d.get('transactions', [])]"
	@echo ""

# ─── Logs ─────────────────────────────────────────────────────────────────────

logs:
	@echo "Tailing Anvil, API, CRE, and Web logs (Ctrl+C to stop)..."
	@tail -f $(ANVIL_LOG) $(API_LOG) $(CRE_LOG) $(WEB_LOG) 2>/dev/null || echo "No log files found yet — start services first"

# ─── Stop / reset ─────────────────────────────────────────────────────────────

deploy-local:
	@echo "→ Deploying contracts to local Anvil..."
	@cd contracts && \
	  DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
	  CRE_UPDATER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
	  forge script script/DeployPassportCreds.s.sol \
	    --rpc-url http://localhost:8545 \
	    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
	    --broadcast \
	  > /tmp/passport-deploy-local.log 2>&1 \
	  && echo "✓ Contracts deployed locally" \
	  || (echo "✗ Deploy failed — check /tmp/passport-deploy-local.log" && cat /tmp/passport-deploy-local.log)

stop:
	@echo "→ Stopping all services..."
	@lsof -ti:3001 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3002 | xargs kill -9 2>/dev/null || true
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || true
	@pkill -f "ngrok http" 2>/dev/null || true
	@pkill -f "anvil" 2>/dev/null || true
	@echo "✓ All services stopped"

down: stop
	@echo "→ Stopping PostgreSQL..."
	@podman compose down
	@echo "✓ PostgreSQL stopped"

reset-db:
	@echo "WARNING: This will wipe all data in the database (including volumes)."
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ]
	@$(MAKE) stop
	@podman compose down -v
	@$(MAKE) db
	@sleep 3
	@$(MAKE) migrate
	@echo "✓ Database reset"

# ─── Testnet deploy ───────────────────────────────────────────────────────────

deploy-testnet:
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  PassportCreds — Testnet Deploy"
	@echo "══════════════════════════════════════════"
	@test -f contracts/.env || (echo "ERROR: contracts/.env missing — fill in DEPLOYER_PRIVATE_KEY, CRE_UPDATER_ADDRESS, RPC_URL" && exit 1)
	@source contracts/.env && \
	  [ -n "$$DEPLOYER_PRIVATE_KEY" ] && [ "$$DEPLOYER_PRIVATE_KEY" != "0x" ] || \
	  (echo "ERROR: DEPLOYER_PRIVATE_KEY not set in contracts/.env" && exit 1)
	@echo "→ Building contracts..."
	@cd contracts && forge build
	@echo "→ Deploying to testnet..."
	@cd contracts && source .env && forge script script/DeployPassportCreds.s.sol \
	  --rpc-url $$RPC_URL \
	  --private-key $$DEPLOYER_PRIVATE_KEY \
	  --broadcast 2>&1 | tee /tmp/passport-deploy.log
	@echo ""
	@echo "✓ Deploy done. Check /tmp/passport-deploy.log for addresses."
	@echo "  Copy the three contract addresses to:"
	@echo "    contracts/deployments.json (testnet section)"
	@echo "    apps/api/.env"
	@echo "    cre/.env"
	@echo "    apps/web/.env.local"
	@echo ""

# ─── The unified demo — one command ───────────────────────────────────────────

demo: demo-chain demo-deploy demo-web
	@echo ""
	@echo "══════════════════════════════════════════"
	@echo "  PassportKit demo — one world, one site"
	@echo ""
	@echo "  Chain:     $(DEMO_RPC) (anvil)"
	@echo "  Site:      $(DEMO_URL)"
	@echo ""
	@echo "  1. Get verified      $(DEMO_URL)/passport"
	@echo "  2. Enter the room    $(DEMO_URL)/deal-room"
	@echo "  3. Trade the pool    $(DEMO_URL)/markets"
	@echo "  4. Mandate an agent  $(DEMO_URL)/concierge"
	@echo ""
	@echo "  Logs: $(DEMO_ANVIL_LOG) · $(DEMO_DEPLOY_LOG) · $(DEMO_WEB_LOG)"
	@echo "  Stop: make demo-stop"
	@echo "══════════════════════════════════════════"
	@echo ""

# Reuses an anvil that is already listening rather than restarting it — a
# restart would wipe the world every other demo is pointed at. A reused chain is
# somebody else's: no pid stamp is written, so `demo-stop` leaves it alone.
demo-chain:
	@if curl -sf -m 2 -X POST $(DEMO_RPC) -H "Content-Type: application/json" \
	     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then \
	  echo "✓ Anvil already up on :$(RPC_PORT) — reusing it (make demo-stop will leave it running)"; \
	else \
	  echo "→ Starting Anvil on :$(RPC_PORT) (log: $(DEMO_ANVIL_LOG))"; \
	  anvil --port $(RPC_PORT) > $(DEMO_ANVIL_LOG) 2>&1 & \
	  echo $$! > $(DEMO_ANVIL_PID); \
	  for i in 1 2 3 4 5 6 7 8 9 10; do \
	    sleep 1; \
	    curl -sf -m 2 -X POST $(DEMO_RPC) -H "Content-Type: application/json" \
	      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1 && break; \
	  done; \
	  curl -sf -m 2 -X POST $(DEMO_RPC) -H "Content-Type: application/json" \
	    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1 \
	    && echo "✓ Anvil up on :$(RPC_PORT)" \
	    || (echo "✗ Anvil failed — check $(DEMO_ANVIL_LOG)" && exit 1); \
	fi

demo-deploy:
	@echo "→ Deploying the one demo world to $(DEMO_RPC) (log: $(DEMO_DEPLOY_LOG))"
	@CODE=$$(cast code $(CREATE2_ADDR) --rpc-url $(DEMO_RPC) 2>/dev/null || echo 0x); \
	 if [ "$$CODE" = "0x" ] || [ -z "$$CODE" ]; then \
	   cast rpc anvil_setCode $(CREATE2_ADDR) $(CREATE2_CODE) --rpc-url $(DEMO_RPC) > /dev/null 2>&1 \
	     && echo "  · CREATE2 deployer re-etched"; \
	 fi
	@cd contracts && forge script script/DeployAll.s.sol --rpc-url $(DEMO_RPC) --broadcast \
	  > $(DEMO_DEPLOY_LOG) 2>&1 \
	  && echo "✓ World deployed — apps/web/demo-addresses.json written" \
	  || (echo "✗ Deploy failed — check $(DEMO_DEPLOY_LOG)" && tail -20 $(DEMO_DEPLOY_LOG) && exit 1)

demo-web:
	@echo "→ Starting the site on :$(WEB_PORT) with DEMO_MODE=true (log: $(DEMO_WEB_LOG))"
	@lsof -ti:$(WEB_PORT) -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
	@pkill -f "[n]ext dev -p $(WEB_PORT)" 2>/dev/null || true
	@sleep 1
	@cd apps/web && RPC_URL=$(DEMO_RPC) WEB_PORT=$(WEB_PORT) npm run demo > $(DEMO_WEB_LOG) 2>&1 &
	@for i in $$(seq 1 40); do sleep 1; curl -sf -m 2 $(DEMO_URL) > /dev/null 2>&1 && break; done
	@curl -sf -m 5 $(DEMO_URL) > /dev/null 2>&1 \
	  && echo "✓ Site up on $(DEMO_URL)" \
	  || (echo "✗ Site failed to start — check $(DEMO_WEB_LOG)" && exit 1)

# Stops only what `make demo` started.
#
# The site is always ours, so it goes by port: `-sTCP:LISTEN` keeps the kill to
# the server rather than anything merely *connected* to it, and the pkill catches
# the npm wrapper the port lookup can miss (`[n]` stops pkill matching its own
# shell). The chain is different — `demo-chain` may have reused an anvil started
# by `make up`, another worktree, or a human — so it is killed by the pid stamp
# only, never by port and never by name.
demo-stop:
	@echo "→ Stopping the demo (:$(WEB_PORT), :$(RPC_PORT))..."
	@lsof -ti:$(WEB_PORT) -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
	@pkill -f "[n]ext dev -p $(WEB_PORT)" 2>/dev/null || true
	@echo "  · site on :$(WEB_PORT) stopped"
	@if [ -f $(DEMO_ANVIL_PID) ]; then \
	  PID=$$(cat $(DEMO_ANVIL_PID)); \
	  if kill -0 $$PID 2>/dev/null; then \
	    kill -9 $$PID 2>/dev/null; echo "  · anvil on :$(RPC_PORT) (pid $$PID) stopped"; \
	  else \
	    echo "  · anvil on :$(RPC_PORT) (pid $$PID) was already gone"; \
	  fi; \
	  rm -f $(DEMO_ANVIL_PID); \
	else \
	  echo "  · anvil on :$(RPC_PORT) was not started by make demo — left running"; \
	fi
	@echo "✓ Demo stopped"

# ─── Block explorer for the demo chain ────────────────────────────────────────
# Points at $(RPC_PORT), so it follows `make demo RPC_PORT=…` to whichever chain
# the demo is actually on. ERIGON_URL is fetched by the Otterscan frontend in
# YOUR browser, not from inside the container — so it must be an address the
# browser can resolve (127.0.0.1), never host.docker.internal.
#
# Set EXPLORER_URL=http://localhost:5100 when starting the demo to make every
# tx hash in the app link here.

demo-explorer:
	@echo "Otterscan explorer for the demo chain on :$(RPC_PORT) → http://localhost:5100"
	@docker run --rm -p 5100:80 \
	  -e ERIGON_URL=http://127.0.0.1:$(RPC_PORT) otterscan/otterscan:latest
