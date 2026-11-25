# Inventory_And_Sales

- `frontend/`: React + TypeScript (Vite)
- `backend/`: Go
- `docker-compose.yml`: PostgreSQL

## Database

Salin `.env.example` ke `.env`, isi `POSTGRES_PASSWORD`, lalu jalankan dari root proyek:

```powershell
Copy-Item .env.example .env
docker compose up -d
```

## Frontend

Dari `D:\project\Inventory_And_Sales\frontend` (Node.js 22.12+):

```powershell
npm ci
npm run dev
```

## Backend

Dari `D:\project\Inventory_And_Sales\backend` (Go 1.26+):

```powershell
go run ./cmd/api
```

Entrypoint backend masih kosong. Belum ada server HTTP, koneksi database, migrasi, seed, atau fitur bisnis.
