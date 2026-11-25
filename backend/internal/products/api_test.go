package products

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL API integration tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("products_test_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+identifier+" CASCADE"); err != nil {
			t.Error(err)
		}
		admin.Close()
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	migration, err := os.ReadFile("../../migrations/001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestProductAPI(t *testing.T) {
	db := testDatabase(t)
	mux := http.NewServeMux()
	Register(mux, db)
	request := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: expected %d, got %d: %s", method, path, status, w.Code, w.Body.String())
		}
		return w
	}
	assertCode := func(w *httptest.ResponseRecorder, code string) {
		t.Helper()
		var envelope struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Error.Code != code || envelope.Error.Message == "" {
			t.Fatalf("unexpected error: %s", w.Body.String())
		}
	}
	for _, body := range []string{`{}`, `{"sku":"A","name":"A","price":-1}`, `{"sku":"A","name":"A","price":1.1}`, `{"sku":"A","name":"A","price":"1"}`, `{"sku":"A","name":"A","price":1,"stock":5}`, `{"sku":"A","name":"A","price":1,"is_active":null}`, `null`, `{} {}`} {
		request("POST", "/api/products", body, 400)
	}
	w := request("POST", "/api/products", `{"sku":" COF-01 ","name":"Kopi Arabika","price":65000}`, 201)
	var p Product
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Stock != 0 || !p.IsActive || p.LastMovementAt != nil || p.SKU != "COF-01" {
		t.Fatalf("unexpected product: %+v", p)
	}
	path := fmt.Sprintf("/api/products/%d", p.ID)
	assertCode(request("POST", "/api/products", `{"sku":"COF-01","name":"Duplicate","price":0}`, 409), "SKU_EXISTS")
	request("POST", "/api/products", `{"sku":"TEA-01","name":"Teh Hijau","price":30000,"is_active":false}`, 201)
	w = request("GET", "/api/products?search=kOpI&page=1&limit=1", "", 200)
	var list List
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if list.Total != 1 || len(list.Data) != 1 || list.Page != 1 || list.Limit != 1 {
		t.Fatalf("unexpected list: %s", w.Body.String())
	}
	for query, total := range map[string]int64{"search=cof": 1, "search=%25": 0, "filter=active": 1, "filter=inactive": 1, "filter=low-stock": 2, "page=2&limit=2": 2} {
		w = request("GET", "/api/products?"+query, "", 200)
		if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
			t.Fatal(err)
		}
		if list.Total != total {
			t.Fatalf("%s: unexpected total %d", query, list.Total)
		}
		if query == "page=2&limit=2" && (len(list.Data) != 0 || !strings.Contains(w.Body.String(), `"data":[]`)) {
			t.Fatal("expected empty array")
		}
	}
	for _, query := range []string{"page=0", "limit=101", "filter=invalid"} {
		assertCode(request("GET", "/api/products?"+query, "", 400), "INVALID_QUERY")
	}
	assertCode(request("PUT", "/api/products/2147483647", `{"sku":"X","name":"X","price":0}`, 404), "PRODUCT_NOT_FOUND")
	request("DELETE", "/api/products/2147483647", "", 404)
	request("DELETE", "/api/products/abc", "", 400)
	request("PUT", path, `{"sku":"TEA-01","name":"X","price":1}`, 409)
	request("PUT", path, `{"sku":"COF-02","name":"Kopi Baru","price":70000}`, 200)
	ctx := context.Background()
	// Fixture simulates the stock stage: movement + stock change in one transaction.
	_, err := db.Exec(ctx, `BEGIN;
        INSERT INTO stock_movements(product_id,type,qty,created_at) SELECT id,'in',3,'2025-01-01T00:00:00Z' FROM products WHERE sku='COF-02';
        INSERT INTO stock_movements(product_id,type,qty,created_at) SELECT id,'in',2,'2025-02-01T00:00:00Z' FROM products WHERE sku='COF-02';
        UPDATE products SET stock=5 WHERE sku='COF-02'; COMMIT;`)
	if err != nil {
		t.Fatal(err)
	}
	w = request("PUT", path, `{"sku":"COF-02","name":"Kopi Baru","price":70000,"is_active":false}`, 200)
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Stock != 5 || p.IsActive || p.LastMovementAt == nil || p.LastMovementAt.Format(time.RFC3339) != "2025-02-01T00:00:00Z" {
		t.Fatalf("stock or max movement incorrect: %+v", p)
	}
	assertCode(request("DELETE", path, "", 409), "PRODUCT_HAS_HISTORY")
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM stock_movements WHERE product_id=$1", p.ID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("history lost: %d %v", count, err)
	}
	w = request("GET", "/api/products?search=COF-02", "", 200)
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || len(list.Data) != 1 || list.Data[0].LastMovementAt == nil {
		t.Fatal("list movement timestamp missing")
	}
	_, err = db.Exec(ctx, `WITH o AS (INSERT INTO sales_orders(customer,total) VALUES ('Test',30000) RETURNING id)
        INSERT INTO sales_order_items(order_id,sku,qty,unit_price) SELECT id,'TEA-01',1,30000 FROM o`)
	if err != nil {
		t.Fatal(err)
	}
	var teaID int32
	if err := db.QueryRow(ctx, "SELECT id FROM products WHERE sku='TEA-01'").Scan(&teaID); err != nil {
		t.Fatal(err)
	}
	teaPath := fmt.Sprintf("/api/products/%d", teaID)
	assertCode(request("PUT", teaPath, `{"sku":"TEA-02","name":"Tea","price":30000}`, 409), "SKU_IN_USE")
	assertCode(request("DELETE", teaPath, "", 409), "PRODUCT_IN_USE")
	w = request("GET", "/api/products/summary?search=not-found&filter=active", "", 200)
	var summary Summary
	if err := json.Unmarshal(w.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if summary.TotalProducts != 2 || summary.ActiveProducts != 0 || summary.TotalStockValue != 350000 || summary.LowStockCount != 2 {
		t.Fatalf("summary not global: %+v", summary)
	}
	w = request("POST", "/api/products", `{"sku":"DEL","name":"Delete Me","price":0}`, 201)
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	w = request("DELETE", fmt.Sprintf("/api/products/%d", p.ID), "", 204)
	if w.Body.Len() != 0 {
		t.Fatal("204 must have empty body")
	}
	// Closed pool proves the public response does not contain raw database errors.
	db.Close()
	assertCode(request("GET", "/api/products", "", 500), "INTERNAL_ERROR")
}
