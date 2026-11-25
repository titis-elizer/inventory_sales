# StockFlow — Inventory & Sales

Tahap 1: fondasi proyek, tanpa business endpoint. Frontend React + TypeScript/Vite; backend Go `net/http` + `pgx`; PostgreSQL 17. Folder repository saat ini bernama `Inventory_And_Sales`, dengan layout backend/frontend sesuai requirement.

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

Script membaca `PORT` dan `DATABASE_URL` dari `.env` root. Alternatif lintas platform: ekspor kedua environment variable tersebut lalu jalankan `go run ./cmd/api` dari `backend/`. Backend memvalidasi konfigurasi, memeriksa koneksi DB saat startup, menyediakan shutdown terkontrol, dan berhenti jika koneksi awal gagal. Tidak ada business route; hanya `GET /api/health` untuk pemeriksaan infrastruktur.

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
- Tahap 1 belum mengisi sample order atau movement; sample order dari requirement keseluruhan dapat ditambahkan bersama tahap transaksi berikutnya.

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
