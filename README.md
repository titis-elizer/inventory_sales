# StockFlow — Inventory & Sales

Fondasi proyek dan API produk. Frontend React + TypeScript/Vite; backend Go `net/http` + `pgx`; PostgreSQL 17. Folder repository saat ini bernama `Inventory_And_Sales`, dengan layout backend/frontend sesuai requirement.

## Prasyarat

- Docker Desktop aktif dengan Linux containers dan Docker Compose.
- Go 1.26+, Node.js 22.12+, npm, dan PowerShell untuk perintah berikut.
- Port lokal 5432 (database), 8080 (backend), dan 5173 (frontend) tersedia.

## Setup

```powershell
Set-Location D:\project\Inventory_And_Sales
# Hanya pada setup awal; jangan menimpa .env yang sudah dikonfigurasi.
Copy-Item .env.example .env
docker compose up -d
docker compose wait setup
docker compose logs setup
```

`setup` harus selesai dengan exit code 0. `docker compose up -d` sendiri belum menjamin migration selesai; cek `wait` dan log sebelum menjalankan aplikasi. Kredensial contoh hanya untuk development. Jika database/user/password/port diubah, sesuaikan juga `DATABASE_URL`. Karakter khusus password di URL perlu URL-encoding. Jangan commit `.env`.

Backend, terminal pertama:

```powershell
Set-Location D:\project\Inventory_And_Sales
.\backend\run.ps1
```

Script membaca `PORT` dan `DATABASE_URL` dari `.env` root. Alternatif lintas platform: ekspor kedua environment variable tersebut lalu jalankan `go run ./cmd/api` dari `backend/`. Backend memvalidasi konfigurasi, memeriksa koneksi DB saat startup, menyediakan shutdown terkontrol, dan berhenti jika koneksi awal gagal. `GET /api/health` memeriksa koneksi database.

Frontend, terminal kedua:

```powershell
Set-Location D:\project\Inventory_And_Sales\frontend
npm ci
npm run dev
```

Buka http://localhost:5173. React memakai `StrictMode`, TypeScript `strict: true`. Vite meneruskan `/api` ke `API_PROXY_TARGET` dari environment proses atau `.env` root (default http://localhost:8080). Tidak ada secret yang diekspos melalui variabel `VITE_*`. Halaman masih minimal dan tidak berisi mock business data.

## Migration dan seed

Compose menjalankan PostgreSQL dengan healthcheck, lalu service `setup` menjalankan `backend/scripts/setup.sql` memakai `psql` dengan fail-fast. Tidak bergantung pada init script volume kosong.

- Empat tabel domain: `products`, `stock_movements`, `sales_orders`, `sales_order_items`, dengan kolom dan relasi sesuai PDF; harga menggunakan PostgreSQL `INTEGER` dalam IDR.
- `schema_migrations` adalah tabel metadata tambahan, bukan tabel domain.
- Migration versi 1 dan seed dijalankan dalam satu transaksi. Advisory transaction lock menserialisasi setup paralel; kegagalan menyebabkan rollback.
- Versi yang sudah tercatat tidak dijalankan ulang. Jangan mengedit migration yang sudah diterapkan; tambahkan file dan blok versi baru pada runner untuk tahap berikutnya.
- Seed menyediakan 12 produk realistis, SKU unik, harga integer, dan stok awal. `ON CONFLICT (sku) DO NOTHING` tidak menggandakan produk atau menimpa harga/stok yang telah berubah. Sequence ID bisa memiliki celah setelah pengulangan, dan ID tidak boleh diasumsikan berurutan.
- Seed sample order tersedia sejak tahap 4: satu aktif dan satu cancelled, beserta movement out/in. Tabel metadata `seed_runs` mencegah replay; pada database baru stok kopi menjadi 38 dan teh hijau 23 setelah sample order. Order cancelled memiliki dampak stok bersih nol.

Ulangi setup tanpa menghapus data:

```powershell
Set-Location D:\project\Inventory_And_Sales
docker compose run --rm setup
```

Jika volume lama memiliki schema dari eksperimen sebelumnya tetapi belum memiliki metadata migration, jangan menghapus data secara otomatis: backup dan rekonsiliasi schema terlebih dahulu. Perubahan kredensial `.env` juga tidak mengubah user/password pada volume PostgreSQL yang sudah ada.

## Verifikasi

```powershell
Set-Location D:\project\Inventory_And_Sales
docker compose ps -a
# Ulangi setup: tidak menggandakan produk.
docker compose run --rm setup

# Saat backend dan Vite berjalan: keduanya harus mengembalikan status ok.
Invoke-RestMethod http://localhost:8080/api/health
Invoke-RestMethod http://localhost:5173/api/health

Set-Location D:\project\Inventory_And_Sales\backend
go vet ./...
go build -o bin/api.exe ./cmd/api

Set-Location D:\project\Inventory_And_Sales\frontend
npm run typecheck
npm run build
```

## Struktur

```text
backend/
  cmd/api/           # Entry point HTTP server
  internal/config/   # Environment validation
  migrations/        # Schema berversi
  seeds/             # Seed produk
  scripts/           # Runner migration dan seed
frontend/
  src/               # React entry point dan halaman minimal
docker-compose.yml
.env.example
README.md
```

Untuk berhenti gunakan `docker compose down` dari root; named volume tetap menyimpan data. `docker compose down -v` menghapus seluruh data proyek dan hanya boleh digunakan jika data development memang boleh dibuang.

## Halaman produk (tahap 5)

Frontend menggunakan backend asli melalui Vite proxy. `src/types.ts` menyimpan shared domain types; `src/api.ts` adalah satu-satunya pemilik fetch, URL, query serialization, dan parsing error. `ApiError` mempertahankan status, code, message, sku, serta available termasuk nilai 0. Tidak ada mock data pada halaman; mock fetch hanya dipakai unit test.

Halaman menyediakan tabel produk, form tambah/edit, delete dengan konfirmasi browser, search debounce 350 ms, filter All/Active/Inactive/Low stock, pagination, dan summary global. Search/filter/ukuran halaman mengembalikan page ke 1. AbortController dan version gate menolak response lama, termasuk saat kriteria berubah sebelum debounce selesai. Mutation sukses memuat ulang tabel serta summary; halaman dikoreksi jika penghapusan membuat page saat ini kosong. Harga IDR, badge status, stok rendah, dan movement relatif ditampilkan; timestamp lengkap tersedia pada tooltip.

Loading ditampilkan selama request; empty dapat dicapai dengan search yang tidak cocok; error/retry dapat dicapai dengan menghentikan backend lalu Refresh. Error mutation ditampilkan tanpa menutup form. Table dapat di-scroll horizontal di layar kecil; form memakai modal native dengan keyboard/focus behavior browser. Summary global tidak dihitung dari halaman/filter lokal.

```powershell
Set-Location D:\project\Inventory_And_Sales\frontend
npm ci
npm run typecheck
npm test
npm run build
```

Vitest menguji validasi harga/nama/SKU, normalisasi payload, reset pagination, request version gate, waktu relatif, format IDR, query encoding, typed error, network/abort handling, dan respons 204. Production build menghasilkan static bundle; deployment production perlu reverse proxy `/api` ke Go (proxy Vite hanya development). Belum ada browser E2E otomatis.

## Stock adjustment & movement history (tahap 6)

Action **Adjustment** membuka modal direction in/out, qty integer positif (1–2147483647), dan note opsional. Submit memakai synchronous gate untuk menolak submit ganda dan controls disabled selama saving. Error mempertahankan input; `409 INSUFFICIENT_STOCK` menampilkan quantity tersedia termasuk nol. Pada gangguan koneksi/server, periksa history sebelum mengulang karena request yang kehilangan respons mungkin sudah diproses server.

Setelah sukses modal ditutup/reset, produk dan summary dimuat ulang, serta panel history produk terkait dibuka/disegarkan. **History** juga dapat dibuka tanpa adjustment; datanya dari API, terbaru dahulu (created_at DESC, id DESC), dengan loading, empty, error/retry, dan refresh manual. Timestamp last movement dibaca ulang dari backend, bukan dibuat secara optimistis di frontend.

Tes unit standar mencakup validasi qty/note, error stok tersedia, kegagalan backend, submission gate, dan kontrak stock/history client. Tes integrasi frontend opt-in (`src/stock.integration.test.ts`) memakai backend asli melalui `STOCKFLOW_TEST_API` (contoh `http://127.0.0.1:5174` untuk proxy development). Tes membuat produk khusus verifikasi dengan saldo akhir nol dan menyimpan audit history; tidak menyentuh stok produk bisnis. Jalankan hanya pada database development/test yang sesuai. Mode `STOCKFLOW_TEST_OFFLINE=1` memverifikasi error dengan backend pengujian sudah dihentikan.

## Sales order interface (stage 7)

The interface is in English, including validation, errors, accessibility labels and timestamps; currency remains IDR. **Create order** opens a customer/items form. Product options come from searchable, paginated `/api/products` results (all statuses, matching backend rules), not mock data or an assumed first page. Selected SKUs remain selected when browsing other option pages. The server revalidates current stock and prices.

Client validation requires a customer, at least one item, valid SKUs, positive int32 quantities and unique case-sensitive SKUs after trimming. Synchronous submission locking prevents duplicate create/cancel requests, with controls disabled while processing. Backend 400 messages remain visible; SKU-specific errors highlight the matching item and show available quantity including zero. Failed creates retain form inputs. No final total is calculated by the client.

Successful creation opens detail from the server response, displaying customer, item quantities, server unit-price snapshots, server total, status, created time and cancellation time. **Refresh detail** reads `GET /api/orders/{id}`. **Cancel order** requires confirmation and updates detail from the cancel response; product stock, global summary and open movement history are refreshed. Returning to products refreshes again so restored stock is visible. No order-list API is added. Leaving the order screen discards its local form/detail; this stage has no order history list or persistent navigation.

An interrupted create response has an ambiguous outcome because the backend has no idempotency key. Do not blindly resubmit; if an ID is known, refresh its detail. Unit tests cover pure order validation, payload normalization, SKU/available errors and the existing API endpoint contracts. Run `npm test`, `npm run typecheck`, and `npm run build` from `D:\project\Inventory_And_Sales\frontend`.

## Sales orders (tahap 4)

| Method | Path | Respons sukses |
|---|---|---|
| POST | `/api/orders` | 201 order lengkap dan header Location |
| GET | `/api/orders/{id}` | 200 order lengkap |
| POST | `/api/orders/{id}/cancel` | 200 order dengan status CANCELLED |

Create hanya menerima `customer` dan `items` berisi `sku`/`qty`:

```json
{"customer":"Kedai Pagi","items":[{"sku":"KOP-AR250","qty":2},{"sku":"TEH-HJ100","qty":1}]}
```

Customer/SKU di-trim. Customer kosong, items kosong, SKU kosong/duplikat/tidak dikenal, qty bukan integer positif ditolak 400. Duplicate diperiksa setelah trim, case-sensitive sesuai SKU database. `unit_price`, `total`, `status`, maupun field asing dari client ditolak. Produk inactive masih boleh dipesan karena kontrak belum melarangnya.

Response order berbentuk `{id,customer,status,total,created_at,cancelled_at,items:[{id,order_id,sku,qty,unit_price}]}`; timestamp UTC. Harga item diambil dari produk yang terkunci dan disimpan sebagai snapshot; perubahan harga produk setelah create tidak mengubah order historis. Total dihitung dengan intermediate int64 dan dibatasi 2147483647 IDR agar sesuai kolom INTEGER. Pelampauan total: 400 `ORDER_TOTAL_OVERFLOW`.

Create mengambil seluruh row lock produk dengan `ORDER BY id FOR UPDATE`, bukan mengikuti urutan input. Semua SKU, total, dan ketersediaan stok diperiksa sebelum penulisan pertama. Order/items/decrement stok/movement out ditulis dalam satu transaksi; kegagalan apa pun me-rollback semuanya. Stok kurang: 409 `{"error":{"code":"INSUFFICIENT_STOCK","message":"Insufficient stock for SKU: ...","sku":"...","available":0}}`. SKU tidak dikenal: 400 `UNKNOWN_SKU`.

Cancel mengambil lock order dan mengecek status di transaksi, lalu mengunci semua produk dalam urutan ID yang sama. Restore stok, movement in, status CANCELLED, dan cancelled_at disimpan atomik. Cancel kedua (termasuk concurrent) mendapat 409 `ORDER_ALREADY_CANCELLED`, tanpa restore tambahan. Jika restore melewati batas INTEGER: 409 `STOCK_LIMIT_EXCEEDED` dan tidak ada perubahan. Order tidak ditemukan: 404 `ORDER_NOT_FOUND`. Movement memakai note `Sales order #ID: in/out`; history tidak dihapus. Detail dibaca dalam snapshot repeatable-read.

Seed `003_orders.sql` dijalankan oleh setup dalam transaksi dan advisory lock yang sama. Marker `seed_runs.sample_orders_v1` baru disimpan setelah seluruh order/stok/movement sukses. Pengulangan tidak membuat order atau mengurangi stok lagi; jika stok development sudah tidak cukup, setup gagal dan rollback tanpa mereset stok. Seed bukan untuk database produksi.

```powershell
$body = @{ customer = 'Kedai Pagi'; items = @(@{ sku = 'KOP-AR250'; qty = 2 }) } | ConvertTo-Json -Depth 4
$order = Invoke-RestMethod http://localhost:8080/api/orders -Method Post -ContentType application/json -Body $body
Invoke-RestMethod "http://localhost:8080/api/orders/$($order.id)"
Invoke-RestMethod "http://localhost:8080/api/orders/$($order.id)/cancel" -Method Post
```

Integration test order memakai `TEST_DATABASE_URL` khusus test dan schema sementara. Pool menyediakan hingga 16 koneksi; test memastikan beberapa PostgreSQL session berbeda. Cakupan meliputi multi-item, snapshot harga, validasi sebelum write, overflow, stok kurang tanpa perubahan, rollback kegagalan movement, cancel concurrent tepat sekali, dan 16 create concurrent dengan urutan SKU berlawanan. Jalankan seluruh pemeriksaan backend seperti petunjuk test di bawah. Request timeout/retry client belum memiliki Idempotency-Key; jangan melakukan retry create secara buta.

## Stock adjustment dan history (tahap 3)

- `POST /api/products/{id}/stock`: body `{"type":"in","qty":10,"note":"Penerimaan barang"}`. Sukses 200 `{product,movement}`; type hanya `in`/`out`, qty integer positif maksimal 2147483647. Note opsional, default string kosong. Null, field asing, dan tipe salah ditolak sesuai decoder JSON terpusat.
- `GET /api/products/{id}/movements`: 200 `{data:[...]}`, terbaru dahulu berdasarkan `created_at DESC, id DESC`; tanpa history mengembalikan array kosong. Timestamp UTC ISO 8601; note dapat null untuk data lama. History saat ini belum dipaginasi.
- Produk tidak ditemukan: 404 `PRODUCT_NOT_FOUND`; validasi salah: 400. Stock out berlebih: 409 `{"error":{"code":"INSUFFICIENT_STOCK","message":"Insufficient stock","available":0}}` (available tetap ada ketika nol). Stock in yang melewati batas INTEGER: 409 `STOCK_LIMIT_EXCEEDED`.
- Adjustment mengambil `SELECT ... FOR UPDATE` pada produk sebelum membaca stok. Update stok dan insert movement berada dalam satu transaksi; kegagalan insert/commit tidak menghasilkan perubahan parsial. Row lock menserialisasi adjustment concurrent serta berkoordinasi dengan update/delete produk. Tidak ada perubahan stok berdasarkan pembacaan tanpa proteksi.
- Movement memakai `clock_timestamp()` saat insert agar timestamp mencerminkan waktu penulisan setelah menunggu lock. History menggunakan snapshot repeatable-read; tidak ada endpoint menghapus history.

Integration test memakai PostgreSQL asli, mencakup stock in/out, penolakan input, rollback ketika stok kurang, rollback jika insert movement gagal, history, batas integer, dan 16 request stock out bersamaan (stok 5: tepat 5 sukses, sisanya 409 available 0).

Jalankan tes hanya pada database test khusus, bukan produksi. Contoh PowerShell dari root, setelah environment PostgreSQL diekspor sesuai `.env` lokal:

```powershell
docker compose exec -T postgres createdb -U $env:POSTGRES_USER stockflow_test
# Ganti user/password/port agar sesuai konfigurasi lokal.
$env:TEST_DATABASE_URL = 'postgres://stockflow:stockflow_local_only@localhost:5432/stockflow_test?sslmode=disable'
Set-Location D:\project\Inventory_And_Sales\backend
go test -count=1 -v ./...
go vet ./...
go build -o bin/api.exe ./cmd/api
```

Setiap integration test membuat schema terisolasi di database test dan membersihkannya setelah selesai. Tanpa `TEST_DATABASE_URL`, integration test di-skip. Database sementara khusus dipakai saat verifikasi tahap 3; database development/produksi tidak digunakan untuk fixture test.

## API produk (tahap 2)

| Method | Path | Respons sukses |
|---|---|---|
| GET | `/api/products?search=&page=1&limit=20&filter=all` | 200 `{data,page,limit,total}` |
| GET | `/api/products/summary` | 200 `{total_products,active_products,total_stock_value,low_stock_count}` |
| POST | `/api/products` | 201 produk dan header `Location` |
| PUT | `/api/products/{id}` | 200 produk terbaru |
| DELETE | `/api/products/{id}` | 204 tanpa body |

Body POST/PUT: `{"sku":"KOP-NEW","name":"Kopi Baru","price":65000,"is_active":true}`.
`sku`, `name`, dan `price` wajib pada kedua operasi; whitespace tepi SKU/nama dibuang. Harga harus integer 0–2147483647 sesuai kolom PostgreSQL INTEGER. `is_active` opsional: default true pada create, dipertahankan pada update jika tidak diberikan. Keunikan SKU bersifat case-sensitive sesuai constraint database; search case-insensitive dan mencocokkan substring literal SKU/nama (bukan wildcard SQL).

`stock`, ID, timestamp, dan field tidak dikenal ditolak. Produk baru selalu stok 0; update hanya mengubah SKU, nama, harga, dan status. Perubahan stok hanya boleh melalui transaksi movement pada tahap berikutnya.

Setiap produk menyertakan `last_movement_at` berupa timestamp RFC3339/ISO 8601 atau null, dihitung menggunakan `MAX(stock_movements.created_at)` pada setiap query—bukan field tersimpan yang dapat kedaluwarsa. List diurutkan ID ascending; count dan data dibaca dalam satu snapshot repeatable-read.

Pagination: default page 1/limit 20; page 1–2147483647, limit 1–100. Halaman di luar hasil tetap 200 dengan `data: []` dan total yang benar. Parameter tidak dikenal, berulang, kosong untuk page/limit, atau invalid ditolak 400. Search kosong berarti semua produk.

Ekstensi filter: `filter=all|active|inactive|low-stock`. Low-stock berarti stok <= 10, termasuk produk inactive. Summary bersifat global: semua produk tanpa filter/search/pagination; total nilai stok adalah jumlah `price * stock` seluruh produk termasuk inactive, dalam integer IDR. Parameter query pada summary tidak memengaruhi hasil.

### Aturan history dan SKU

- Update SKU yang sudah direferensikan `sales_order_items` ditolak 409 `SKU_IN_USE`, termasuk order cancelled. Tidak ada cascade perubahan SKU historis. Field non-SKU tetap boleh diedit.
- Movement mereferensikan ID produk: SKU produk dengan movement saja masih boleh diedit.
- Delete produk dengan movement ditolak 409 `PRODUCT_HAS_HISTORY`; history tidak dihapus.
- Delete produk yang hanya direferensikan order ditolak 409 `PRODUCT_IN_USE`.
- Update/delete mengambil row lock produk dalam transaksi. Foreign key tetap menjadi proteksi referensi concurrent; tidak ada cascade delete atau update.

### Error

```json
{"error":{"code":"VALIDATION_ERROR","message":"sku is required"}}
```

Kode utama: 400 `INVALID_JSON`, `VALIDATION_ERROR`, `INVALID_QUERY`, `INVALID_ID`; 404 `PRODUCT_NOT_FOUND`; 409 `SKU_EXISTS`, `SKU_IN_USE`, `PRODUCT_HAS_HISTORY`, `PRODUCT_IN_USE`; 413 `BODY_TOO_LARGE`; 415 `UNSUPPORTED_MEDIA_TYPE`; 500 `INTERNAL_ERROR`. Error database hanya dicatat di server, tidak dikirim ke client.

POST/PUT wajib `Content-Type: application/json`, body maksimal 1 MiB, tepat satu object JSON. Salah tipe, null, field tidak dikenal, JSON rusak, dan body tambahan ditolak. Harga decimal/string tidak dikonversi otomatis.

Contoh PowerShell:

```powershell
Invoke-RestMethod 'http://localhost:8080/api/products?search=kopi&page=1&limit=10&filter=active'
Invoke-RestMethod 'http://localhost:8080/api/products/summary'
$body = @{ sku = 'NEW-001'; name = 'Kopi Baru'; price = 65000 } | ConvertTo-Json
$product = Invoke-RestMethod http://localhost:8080/api/products -Method Post -ContentType application/json -Body $body
Invoke-RestMethod "http://localhost:8080/api/products/$($product.id)" -Method Put -ContentType application/json -Body $body
Invoke-RestMethod "http://localhost:8080/api/products/$($product.id)" -Method Delete
```

### Test backend

```powershell
Set-Location D:\project\Inventory_And_Sales\backend
$env:TEST_DATABASE_URL = $env:DATABASE_URL # set terlebih dahulu jika belum diekspor
go test -count=1 -v ./...
go vet ./...
go build -o bin/api.exe ./cmd/api
```

Gunakan database development/test, bukan production. Integration test PostgreSQL membuat schema sementara, menerapkan migration, lalu menghapus schema saat selesai; user DB harus memiliki izin CREATE SCHEMA. Tanpa `TEST_DATABASE_URL`, integration test di-skip dan unit test tetap berjalan. Test mencakup CRUD, validasi, pagination/search/filter, MAX movement, larangan modifikasi stok, proteksi history/order, summary global, dan sanitasi error server.
