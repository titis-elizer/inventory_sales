# Final requirement audit and verification

Date: **November 25, 2026 (UTC+07:00)**. Audit started with requirements/code inspection around 17:15; checks completed and documentation reviewed around 17:27. This wall-clock interval is not an active-hours timesheet. Actual focused hours for the whole project are unknown.

## Requirement-by-requirement audit

| Requirement | Implementation/evidence | Result |
|---|---|---|
| Required repository layout and stack | backend/cmd/internal; React/strict TS/Vite; Go/pgx/PostgreSQL | Complete; root folder name differs, documented |
| Four required tables and constraints | backend/migrations/001_init.sql | Complete |
| Product paginated/search API + last_movement_at | Product API tests; MAX movement query, case-insensitive literal search | Complete |
| Product create/update/delete validation | Real DB API tests and browser CRUD | Complete |
| 409 history-protected delete; history never removed | FK/transaction protection and tests | Complete |
| Atomic adjustment + positive qty + insufficient available | TestStockAPI, rollback constraint failure, browser modal | Complete |
| History API newest first | ORDER BY timestamp DESC,id DESC, tests | Complete |
| Order input validation before writes | TestOrderAPI invalid/unknown/duplicate/qty/empty cases with unchanged DB state | Complete |
| Server prices and total | Locked price snapshots, API tests, browser detail | Complete |
| Multi-item all-or-nothing order | Insufficient second item + injected second-item movement failure assert unchanged orders/items/movements/stocks | Complete |
| No overselling under concurrent orders | TestConcurrentOrders: 16 requests, two SKUs in opposite order, stock 5; exactly 5 orders | Complete |
| Cancel restores once, including concurrent calls | TestOrderAPI simultaneous cancel, one 200/one 409, exact restored stock and in-movement count | Complete |
| Product table/search/filter/pagination/states | Unit logic, API tests, browser empty/loading/offline/retry/refresh | Complete |
| Adjustment modal visible 409 + available, retained input | Browser real overdraw and network failure | Complete |
| Create order customer/items/duplicate/qty validation | 24 order pure-logic tests, real SKU selection | Complete |
| Backend 400 and precise SKU 409 visible | Browser real total overflow 400 and stock conflict 409 | Complete |
| Detail server total/status/items; confirmed cancel | Browser server detail/cancel and restored list stock | Complete |
| Server summary refreshed after mutations | API integrations + shared refresh callback + browser flows | Complete |
| Single client/shared types/no domain any | frontend/src/api.ts/types.ts, strict TS build | Complete |
| Real frontend/backend development integration | Vite proxy; browser and live API tests, no response stubs in application | Complete |
| Compose migration/seed + 12 products/sample orders | New-volume setup and idempotent replay | Complete |
| Tests and meaningful commit history | Backend DB/concurrency/race; frontend unit/live/browser; staged commits | Complete |
| README setup/curl/design/extensions/limitations/honest time | README.md | Complete; focused hours unknown, explicitly disclosed |
| <=5-minute runnable reviewer path | Fresh volume 18.98s; clean npm install + tests/typecheck/build 29.41s, existing caches | Verified locally under 5 min; cold internet downloads not guaranteed |
| No bonus features added | No order list/report/idempotency or app containerization added | Complete |
| Assignment prohibition on AI generation | AI assistance was used and disclosed | **Not compliant without evaluator approval** |

## Checks actually run

### Isolated infrastructure

`scripts/verify-clean.ps1 -ProjectName stockflow-final-20261125 -DatabasePort 55432` created a new Compose project and named volume **stockflow-final-20261125_postgres_data**. Existing project **inventory-and-sales** on port 5432 was not modified or removed.

- PostgreSQL 17-alpine with healthcheck; migration/seed exited 0.
- Fresh state `[products,orders,items,movements,sum(stock)] = [12,2,3,4,513]`.
- Setup replay returned identical state, no replayed orders/stock changes.
- Measured setup + replay: **18.98 seconds**, PostgreSQL image already cached.
- Verification volume retained; no volume deletion performed.

### Backend, real PostgreSQL

- `go test -count=1 -v ./...`: passed; TEST_DATABASE_URL pointed to port 55432 verification DB (not skipped).
- `go test -count=5 -run 'TestConcurrentOrders|TestOrderAPI|TestConcurrentStockOut' ./internal/orders ./internal/products`: passed five repetitions, including multi-item rollback, real competing database sessions and exactly-once cancel.
- `go vet ./...` and `go build -o bin/api-final.exe ./cmd/api`: passed.
- Native Windows `go test -race ./...`: attempted, unsupported because CGO_ENABLED=0 and no C compiler.
- Docker `golang:1.26` on Linux, same dedicated PostgreSQL network: `go test -race -count=1 ./...` **passed**, exit 0, all test packages. Race detection supplements rather than replaces database-concurrency assertions.

Injected SQL failures intentionally log constraint errors during rollback tests; these were expected and assertions passed. The order rollback test now rejects only product B's out movement so A's item/stock/movement have already been written inside the transaction before failure.

### Frontend

- Separate source copy with no node_modules/dist: `npm ci --no-audit --no-fund`, `npm test`, `npm run typecheck`, `npm run build`: passed; **66 unit tests**, three opt-in live cases skipped. Total measured **29.41 seconds** with npm download cache available.
- Working tree with both live API variables configured and serial file execution: **68 passed, 1 skipped** (offline scenario intentionally excluded while server running).
- After stopping only the verification backend: offline stock/history test **1 passed, 1 skipped** (online scenario excluded).
- Typecheck and production build rerun after test configuration fix: passed.
- Initial combined live run failed because stock/order files concurrently altered the shared global summary baseline. Fixed by `vitest.config.ts` fileParallelism=false; final serial run passed. This was test fixture interference, not backend overselling.
- Failed initial fixture attempts remain in the dedicated audit DB, including nonzero fixtures; no business database is affected. Successful scenarios restore their dedicated products to zero balance.

### Browser, actual Chrome headless and real API

Used local Chrome debugging protocol against Vite port 5175 → Go port 8082 → PostgreSQL verification port 55432, without stubbed business responses. The initial navigation attempt had a blank document during dev-server startup and timed out; retry after health/module readiness passed.

**13 recorded scenarios passed**, no Runtime exceptions:

1. Product create and table refresh.
2. Product edit reflected in table.
3. Empty movement history.
4. Stock in updates list, last movement and history; stock out also verified.
5. Real stock 409 available=3 in modal, quantity retained and re-enabled.
6. Order 409 highlights the exact SKU with available=3.
7. Real backend 400 order-total overflow validation shown in UI.
8. Server order detail, native confirmation accepted, cancel status and restored product stock.
9. Product empty state and search recovery.
10. Browser network-offline error and retry controls in list/summary.
11. Loading visible with network latency, successful retry recovery.
12. Offline adjustment error and note input retained.
13. Confirmed deletion of a no-history product and refreshed empty result.

Reproducible script: `scripts/verify-browser.mjs` (explicit dedicated-DB opt-in, Node 22+ and Chrome). Local screenshots/results are ignored under `.tools`. This is not a cross-browser/responsive/accessibility certification.
The repository version of that script was rerun successfully: all 13 scenarios passed again, without browser Runtime exceptions.

## Must-have fixes made in this audit

- Strengthened multi-item rollback to fail on the second movement after first-item writes.
- Added synchronous product-form submission gate (not only render-time disabled state).
- Committed previously local-only configuration tests for reproducibility.
- Serialized live frontend test files to protect shared summary baselines.
- Replaced stale README with complete reviewer setup, environment, migration/seeds, every required endpoint's curl example, extensions, transaction/cancel/timestamp design and honest limitations.
- Added safe isolated setup verification and reproducible browser audit scripts. No bonus application features/endpoints added.

## Remaining limitations

No guaranteed cold-network setup SLA, no active-hours timesheet, no native Windows race toolchain (Linux race passed), no production auth/deployment, no idempotent retry, no persistent order route/list, no history pagination, no maintained cross-browser CI. These are disclosed, not presented as tested features. AI-assistance restriction remains a non-code compliance issue requiring evaluator approval. See README for assumptions and future improvements.