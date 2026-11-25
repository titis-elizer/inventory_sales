# StockFlow — Inventory & Sales

React 19 + strict TypeScript/Vite, Go `net/http`/`pgx`, PostgreSQL 17. All application flows use the real API; response mocks exist only in unit tests. The repository is named `Inventory_And_Sales` and contains the required backend/frontend/Compose layout.

## Reviewer quick start

Prerequisites: Docker Desktop running Linux containers and Compose, Go **1.26+**, Node.js **22.12+**, npm. Free ports: **5432, 8080, 5173**. These PowerShell commands start at the repository root (`D:\project\Inventory_And_Sales` in the implementation environment). Ignored `.tools` files are not required.

```powershell
# Initial setup only; never overwrite a configured .env.
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d
docker compose wait setup
docker compose logs setup
# Migration/seed service must exit 0.
```

Terminal 1, root:

```powershell
.\backend\run.ps1
```

Terminal 2:

```powershell
Set-Location frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. The application commands are `backend/run.ps1` and `npm run dev` after dependency installation. On Linux/macOS export `DATABASE_URL` and `PORT`, then run `go run ./cmd/api` inside `backend/`. Vite proxies `/api` to Go; no development CORS setup is needed. Production needs static hosting of `frontend/dist` and an `/api` reverse proxy.

Designed for <=5-minute setup with prerequisites installed and working downloads. `VERIFICATION.md` records actual measured timings/cache conditions; cold image/package downloads on another machine cannot be guaranteed under five minutes.

### Environment

| Variable | Example/default | Purpose |
|---|---|---|
| POSTGRES_DB | stockflow | Compose database |
| POSTGRES_USER | stockflow | Compose user |
| POSTGRES_PASSWORD | stockflow_local_only | Required development-only password |
| POSTGRES_PORT | 5432 | Loopback host DB port |
| PORT | 8080 | API listen port |
| DATABASE_URL | See `.env.example` | API PostgreSQL URL |
| API_PROXY_TARGET | http://localhost:8080 | Vite proxy; process environment takes precedence |
| TEST_DATABASE_URL | Dedicated test database URL | Enables backend integration tests |

`backend/run.ps1` reads PORT/DATABASE_URL from root `.env`; Vite reads root `.env` for its proxy. Keep URLs consistent with changed ports/credentials; URL-encode special password characters. Existing volumes retain their original database credentials. `.env` is ignored; no secrets use `VITE_*`.

Stop with `docker compose stop` or `docker compose down` **without `-v`**. Do not remove existing data/volumes to fix setup problems.

## Migration and seed

Compose healthchecks PostgreSQL, then runs one-shot `setup` using `backend/scripts/setup.sql`, `psql -X -v ON_ERROR_STOP=1`. It does not depend on empty-volume entrypoint scripts.

- One transaction and advisory transaction lock serialize setup. `schema_migrations` records versions; `001_init.sql` creates four domain tables, constraints and indexes.
- `002_demo.sql`: 12 realistic products, unique SKUs, integer IDR prices, initial stock. ON CONFLICT DO NOTHING does not overwrite changed data.
- `003_orders.sql`: one CREATED and one CANCELLED sample order with items/movements. `seed_runs` prevents replay. Fresh state: 12 products, 2 orders, 3 items, 4 movements, total stock 513.
- Repeat setup is idempotent; failures roll back. Sequence gaps are normal. Never edit an applied migration; add a new version and runner block instead.
- Reconcile/back up a pre-existing experimental schema without metadata; do not wipe it automatically. Seeds are for development, not production.

```powershell
docker compose run --rm setup
```

## Required interface workflows

- Products: SKU/name, IDR price, stock, status, relative last movement and timestamp tooltip; create/edit/delete, debounce 350 ms, All/Active/Inactive/Low stock filters, pagination and server-global summary.
- Criteria reset page 1. Abort/version guards reject stale responses, including search reversion. Deletion corrects empty pages. Loading/empty/error/retry states are reachable.
- Adjustment: in/out, positive integer qty, note, synchronous duplicate-submit lock, disabled saving controls. A 409 displays available quantity including zero; failed requests preserve input. Success resets/closes modal and refreshes product, summary and newest-first history.
- Orders: customer, add/remove items, searchable/paginated real SKU options, positive int32 quantities, duplicate/empty validation. Backend 400 messages are visible. A 409 highlights the precise SKU and quantity available. Failed creation retains inputs.
- Detail displays server item-price snapshots/total/status/times. Client never sends or calculates final total. Refresh uses detail API. Confirmed cancellation refreshes products, summary and open history; returning to products reloads restored stock.
- English UI/accessibility/messages, English date/number locale, IDR currency. Database product names/notes are not translated.

## API and curl examples

Examples use **Bash-compatible quoting** (Windows: Git Bash/WSL; native PowerShell may use Invoke-RestMethod). Replace IDs with actual response IDs; sequences need not be contiguous. Run against development/test only.

```bash
BASE=http://localhost:8080
curl -i "$BASE/api/health"
curl -i "$BASE/api/products?search=kopi&page=1&limit=10"
curl -i "$BASE/api/products?search=&page=1&limit=10&filter=low-stock"
curl -i "$BASE/api/products/summary"

curl -i -X POST "$BASE/api/products" -H 'Content-Type: application/json' \
  -d '{"sku":"REVIEW-001","name":"Review coffee","price":25000,"is_active":true}'
PRODUCT_ID=13 # REPLACE with response id
curl -i -X PUT "$BASE/api/products/$PRODUCT_ID" -H 'Content-Type: application/json' \
  -d '{"sku":"REVIEW-001","name":"Review coffee updated","price":26000,"is_active":true}'
curl -i -X POST "$BASE/api/products/$PRODUCT_ID/stock" -H 'Content-Type: application/json' \
  -d '{"type":"in","qty":5,"note":"Review receipt"}'
curl -i -X POST "$BASE/api/products/$PRODUCT_ID/stock" -H 'Content-Type: application/json' \
  -d '{"type":"out","qty":1,"note":"Review stock out"}'
curl -i "$BASE/api/products/$PRODUCT_ID/movements"
# Expected 409, including available quantity
curl -i -X POST "$BASE/api/products/$PRODUCT_ID/stock" -H 'Content-Type: application/json' \
  -d '{"type":"out","qty":99,"note":"Expected conflict"}'

curl -i -X POST "$BASE/api/orders" -H 'Content-Type: application/json' \
  -d '{"customer":"Review buyer","items":[{"sku":"REVIEW-001","qty":2}]}'
ORDER_ID=3 # REPLACE with response id
curl -i "$BASE/api/orders/$ORDER_ID"
curl -i -X POST "$BASE/api/orders/$ORDER_ID/cancel"
# Second cancel: 409 ORDER_ALREADY_CANCELLED
curl -i -X POST "$BASE/api/orders/$ORDER_ID/cancel"

curl -i -X POST "$BASE/api/products" -H 'Content-Type: application/json' \
  -d '{"sku":"REVIEW-DELETE","name":"Disposable review product","price":0}'
DELETE_ID=14 # REPLACE with response id
curl -i -X DELETE "$BASE/api/products/$DELETE_ID" # 204
curl -i -X DELETE "$BASE/api/products/$PRODUCT_ID" # 409 PRODUCT_HAS_HISTORY
# Expected backend validation 400
curl -i -X POST "$BASE/api/orders" -H 'Content-Type: application/json' \
  -d '{"customer":"Review buyer","items":[]}'
```

| Endpoint | Success |
|---|---|
| GET /api/products | `{data,page,limit,total}` |
| POST /api/products | 201 product + Location |
| PUT /api/products/{id} | 200 product; missing 404 |
| DELETE /api/products/{id} | 204; history 409 |
| POST /api/products/{id}/stock | `{product,movement}` |
| GET /api/products/{id}/movements | `{data:[...]}`, newest first |
| POST /api/orders | 201 order/items/server prices/total + Location |
| GET /api/orders/{id} | Order/items/status/total |
| POST /api/orders/{id}/cancel | Updated CANCELLED order |

Pagination defaults page 1/limit 20, max limit 100. Result pages beyond the end return empty data with correct total. Unknown/repeated/invalid query parameters return 400. Search is case-insensitive literal substring on SKU/name. Product writes accept only sku/name/price/is_active; stock cannot be edited. Price is integer 0–2147483647; SKU/name are trimmed. SKU uniqueness is case-sensitive. Missing is_active defaults true on create and is preserved on update.

### API extensions

No order-list/report endpoint was added. Extensions needed by the interface/safety:

1. `filter=all|active|inactive|low-stock`; low stock <=10 includes inactive products.
2. `/api/products/summary`: global total_products, active_products, total_stock_value, low_stock_count, unaffected by search/page/filter. Stock value includes inactive products.
3. `/api/health`: DB-aware health, 200 status ok / 503 unavailable.
4. SKU changes referenced by any order return SKU_IN_USE; delete of order-referenced products returns PRODUCT_IN_USE, preserving references.

Errors: `{error:{code,message,sku?,available?}}`; available zero is preserved. Main codes: 400 INVALID_JSON/VALIDATION_ERROR/INVALID_QUERY/INVALID_ID/UNKNOWN_SKU/ORDER_TOTAL_OVERFLOW; 404 PRODUCT_NOT_FOUND/ORDER_NOT_FOUND; 409 SKU_EXISTS/SKU_IN_USE/PRODUCT_HAS_HISTORY/PRODUCT_IN_USE/INSUFFICIENT_STOCK/STOCK_LIMIT_EXCEEDED/ORDER_ALREADY_CANCELLED. Writes require application/json, <=1 MiB, one object and known fields. Wrong types/nulls are rejected; internal DB errors are logged, not leaked.

## Transaction design

- Adjustment locks product FOR UPDATE, checks stock, then updates stock and inserts movement in one transaction; failure/overflow/overdraw cannot partially commit.
- Order create validates input, locks all products in ascending **product ID**, validates every SKU/quantity/price/total/availability before business writes. Prices are read under lock and snapshotted. Order/items/decrements/out movements commit together. Failure on item two rolls item one back.
- Consistent lock ordering reduces deadlocks with opposite client item order. Row locks serialize overlapping orders/adjustments; CHECK/UNIQUE/FK constraints add protection. This is not an unprotected SELECT-then-UPDATE.
- Cancel locks order first, checks status, then products in the same order. Stock restore/in movements/CANCELLED/cancelled_at commit together. Concurrent second cancel gets 409 without another restore. Overflow rolls back.
- Multi-query list/detail/history use repeatable-read snapshots. History sorts created_at DESC,id DESC; no history deletion endpoint exists.
- `last_movement_at` is derived as MAX(stock_movements.created_at), not a denormalized field. Movement clock_timestamp() is recorded after lock acquisition, not at transaction start.
- Money uses PostgreSQL INTEGER IDR; order arithmetic uses int64 intermediates and rejects totals above 2147483647. Summary multiplies bigint operands. Extremely large summary values may exceed JavaScript's exact-number range: a documented scale limitation.

## Tests and isolated setup verification

Use dedicated test DBs, never production. Backend integration tests create/drop temporary schemas and require CREATE SCHEMA permission. Without TEST_DATABASE_URL they are **skipped**; green unit-only tests do not prove DB correctness.

```powershell
# Root: NEW Compose project/volume; refuses to reuse an existing project.
.\scripts\verify-clean.ps1
# Set the printed URL; default port is 55432.
$env:TEST_DATABASE_URL = 'postgres://stockflow_verify:verify_local_only@127.0.0.1:55432/stockflow_verify?sslmode=disable'
Set-Location backend
go test -count=1 -v ./...
go test -race -count=1 ./... # CGO + supported C compiler required
go test -count=5 -run 'TestConcurrentOrders|TestOrderAPI|TestConcurrentStockOut' ./internal/orders ./internal/products
go vet ./...
go build -o bin/api ./cmd/api
```

Native Windows without CGO/compiler cannot run race. A Linux alternative actually used here (replace project/network name when different):

```powershell
# Root, with dedicated verification PostgreSQL running
docker run --rm --network stockflow-final-20261125_default `
  -e TEST_DATABASE_URL=postgres://stockflow_verify:verify_local_only@postgres:5432/stockflow_verify?sslmode=disable `
  -v "${PWD}/backend:/workspace" -w /workspace golang:1.26 `
  sh -c 'go test -race -count=1 ./...'
```

Real PostgreSQL concurrency checks are independent of race detection: 16 simultaneous two-SKU orders with stock five must yield five successes and correct stock/order/item/movement counts; two concurrent cancels restore once; 16 stock-outs from stock five yield exactly five successes.

```powershell
Set-Location frontend
npm ci
npm test
npm run typecheck
npm run build
# Optional real-API checks; only a dedicated verification backend/DB!
$env:STOCKFLOW_ORDER_TEST_API = 'http://127.0.0.1:5175'
npm test -- src/order.integration.test.ts
Remove-Item Env:\STOCKFLOW_ORDER_TEST_API
$env:STOCKFLOW_TEST_API = 'http://127.0.0.1:5175'
npm test -- src/stock.integration.test.ts
# Stop the test backend, then set STOCKFLOW_TEST_OFFLINE=1 for its offline case.
```

Optional frontend integration tests retain audit records and create products with final stock zero. Ordinary unit runs skip them. See `VERIFICATION.md` for requirement audit, actual results, cache conditions and browser checks.
Vitest runs files serially because live tests compare a global summary baseline; do not run competing writers against that verification database. An interrupted/failed test may retain a nonzero fixture, so keep all live runs on the dedicated database.

## Assumptions, limitations, next improvements

- Inactive products can be ordered: the contract does not prohibit it. Customer/SKU are trimmed; SKU identity is case-sensitive. Low stock includes inactive products.
- Local-development assignment, not a production security system: no auth/RBAC, TLS deployment, backups or rate limiting.
- No order list or bookmarked detail route. Leaving detail discards that local view. Movement history is unpaginated.
- No Idempotency-Key (bonus deliberately omitted). A lost response may mean a mutation committed. Submit guards prevent simultaneous requests, not safe blind retries; inspect history/order status first.
- Server prices/stock may change after selection; backend is authoritative. No final-total prediction is used.
- A local browser audit is not a maintained cross-browser E2E suite. Production setup/download performance is network-dependent.
- Reproduce the local Chrome audit with `scripts/verify-browser.mjs`: run the dedicated seeded verification API/Vite at port 5175, set `STOCKFLOW_BROWSER_VERIFY=1`, then `node scripts/verify-browser.mjs` from root. Override `CHROME_PATH` or `STOCKFLOW_BROWSER_ORIGIN` as needed. It uses Chrome's debugging protocol without extra packages, writes screenshots/results under ignored `.tools`, and creates retained audit fixtures. It must not target business data. Debug port 9223 must be free.
- Future work, not implemented: idempotency, CI/browser E2E, authenticated deployment, movement pagination, persistent order detail and exact large-summary transport. No bonus feature endpoints are included.

### Honest effort and assignment restriction

No timesheet or trustworthy active-hours record was provided: **focused hours are unknown, not fabricated**. Commit timestamps are activity evidence, not hours worked. First foundation commit: November 25, 2026, 14:49:19 +07:00; stage 7 commit: 17:13:16 +07:00. The final audit wall-clock interval is recorded in `VERIFICATION.md`, not claimed as focused working hours.

The assignment prohibits AI code generation. This implementation used AI assistance at the user's request after disclosure. It must not be represented as compliant with that non-code rule without evaluator approval.