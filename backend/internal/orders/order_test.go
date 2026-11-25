package orders

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func database(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a dedicated test database")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("orders_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error(err)
		}
		admin.Close()
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 16
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	sql, err := os.ReadFile("../../migrations/001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, string(sql)); err != nil {
		t.Fatal(err)
	}
	return db
}

func request(mux http.Handler, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestOrderAPI(t *testing.T) {
	db := database(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	Register(mux, db)
	if _, err := db.Exec(ctx, `INSERT INTO products(sku,name,price,stock) VALUES ('A','Coffee',10000,10),('B','Tea',5000,4),('MAX','Expensive',2147483647,5)`); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := request(mux, method, path, body)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w
	}
	state := func() string {
		t.Helper()
		var value string
		err := db.QueryRow(ctx, `SELECT json_build_array((SELECT count(*) FROM sales_orders),(SELECT count(*) FROM sales_order_items),(SELECT count(*) FROM stock_movements),(SELECT json_agg(stock ORDER BY id) FROM products))::text`).Scan(&value)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	initial := state()
	for _, body := range []string{
		`{"customer":" ","items":[{"sku":"A","qty":1}]}`, `{"customer":"C","items":[]}`,
		`{"customer":"C","items":[{"sku":"A","qty":1},{"sku":" A ","qty":1}]}`,
		`{"customer":"C","items":[{"sku":"A","qty":1},{"sku":"UNKNOWN","qty":1}]}`,
		`{"customer":"C","items":[{"sku":"A","qty":0}]}`, `{"customer":"C","items":[{"sku":"A","qty":-1}]}`,
		`{"customer":"C","items":[{"sku":"A","qty":1.5}]}`, `{"customer":"C","items":[{"sku":"A","qty":"1"}]}`,
		`{"customer":"C","items":[{"sku":"A","qty":1,"unit_price":1}]}`,
		`{"customer":"C","items":[{"sku":"MAX","qty":2}]}`,
		`{"customer":"C","items":[{"sku":"A","qty":null}]}`,
	} {
		call("POST", "/api/orders", body, 400)
		if state() != initial {
			t.Fatal("invalid order wrote data")
		}
	}
	w := call("POST", "/api/orders", `{"customer":"C","items":[{"sku":"A","qty":1},{"sku":"B","qty":5}]}`, 409)
	if !strings.Contains(w.Body.String(), `"sku":"B"`) || !strings.Contains(w.Body.String(), `"available":4`) {
		t.Fatal(w.Body.String())
	}
	if state() != initial {
		t.Fatal("insufficient order changed state")
	}
	w = call("POST", "/api/orders", `{"customer":" Buyer ","items":[{"sku":"B","qty":1},{"sku":"A","qty":2}]}`, 201)
	var o Order
	if err := json.Unmarshal(w.Body.Bytes(), &o); err != nil {
		t.Fatal(err)
	}
	if o.Total != 25000 || o.Status != "CREATED" || o.Customer != "Buyer" || len(o.Items) != 2 || o.Items[0].UnitPrice != 5000 || o.Items[1].UnitPrice != 10000 {
		t.Fatal(w.Body.String())
	}
	path := fmt.Sprintf("/api/orders/%d", o.ID)
	if _, err := db.Exec(ctx, "UPDATE products SET price=99999 WHERE sku='A'"); err != nil {
		t.Fatal(err)
	}
	w = call("GET", path, "", 200)
	var detail Order
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Total != 25000 || detail.Items[1].UnitPrice != 10000 {
		t.Fatal("historical price changed")
	}
	var stockA, stockB, outCount int
	if err := db.QueryRow(ctx, `SELECT (SELECT stock FROM products WHERE sku='A'),(SELECT stock FROM products WHERE sku='B'),(SELECT count(*) FROM stock_movements WHERE type='out')`).Scan(&stockA, &stockB, &outCount); err != nil {
		t.Fatal(err)
	}
	if stockA != 8 || stockB != 3 || outCount != 2 {
		t.Fatal("incorrect order writes")
	}
	if _, err := db.Exec(ctx, `ALTER TABLE stock_movements ADD CONSTRAINT reject_cancel CHECK(type <> 'in') NOT VALID`); err != nil {
		t.Fatal(err)
	}
	beforeCancel := state()
	call("POST", path+"/cancel", "", 500)
	if state() != beforeCancel {
		t.Fatal("failed cancel changed stock/history")
	}
	w = call("GET", path, "", 200)
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Status != "CREATED" || detail.CancelledAt != nil {
		t.Fatal("failed cancel changed order status")
	}
	if _, err := db.Exec(ctx, `ALTER TABLE stock_movements DROP CONSTRAINT reject_cancel`); err != nil {
		t.Fatal(err)
	}
	// Two simultaneous cancellations, on separate pool connections: exactly one succeeds.
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; responses <- request(mux, "POST", path+"/cancel", "") }()
	}
	close(start)
	wg.Wait()
	close(responses)
	success, conflict := 0, 0
	for w := range responses {
		if w.Code == 200 {
			success++
			if err := json.Unmarshal(w.Body.Bytes(), &o); err != nil {
				t.Fatal(err)
			}
		} else if w.Code == 409 && strings.Contains(w.Body.String(), "ORDER_ALREADY_CANCELLED") {
			conflict++
		} else {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if success != 1 || conflict != 1 || o.Status != "CANCELLED" || o.CancelledAt == nil {
		t.Fatal("cancel not exactly once")
	}
	if err := db.QueryRow(ctx, `SELECT (SELECT stock FROM products WHERE sku='A'),(SELECT stock FROM products WHERE sku='B'),(SELECT count(*) FROM stock_movements WHERE type='in')`).Scan(&stockA, &stockB, &outCount); err != nil {
		t.Fatal(err)
	}
	if stockA != 10 || stockB != 4 || outCount != 2 {
		t.Fatal("cancel stock/movement incorrect")
	}
	call("POST", path+"/cancel", "", 409)
	call("GET", "/api/orders/2147483647", "", 404)
	call("POST", "/api/orders/2147483647/cancel", "", 404)
	// Force a late movement failure to prove order, items, and stock roll back.
	if _, err := db.Exec(ctx, `ALTER TABLE stock_movements ADD CONSTRAINT reject_order_out CHECK(type <> 'out' OR product_id <> (2)) NOT VALID`); err != nil {
		t.Fatal(err)
	}
	before := state()
	// A's item, stock update, and movement succeed before B's movement fails.
	call("POST", "/api/orders", `{"customer":"C","items":[{"sku":"A","qty":1},{"sku":"B","qty":1}]}`, 500)
	if state() != before {
		t.Fatal("late failure not atomic")
	}
}

func TestConcurrentOrders(t *testing.T) {
	db := database(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	Register(mux, db)
	if _, err := db.Exec(ctx, `INSERT INTO products(sku,name,price,stock) VALUES ('A','A',100,5),('B','B',200,5)`); err != nil {
		t.Fatal(err)
	}
	// Hold multiple connections simultaneously and assert distinct PostgreSQL sessions.
	a, err := db.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	b, err := db.Acquire(ctx)
	if err != nil {
		a.Release()
		t.Fatal(err)
	}
	if a.Conn().PgConn().PID() == b.Conn().PgConn().PID() {
		t.Fatal("expected multiple sessions")
	}
	a.Release()
	b.Release()
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, 16)
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			items := `[{"sku":"A","qty":1},{"sku":"B","qty":1}]`
			if i%2 == 1 {
				items = `[{"sku":"B","qty":1},{"sku":"A","qty":1}]`
			}
			responses <- request(mux, "POST", "/api/orders", `{"customer":"Concurrent","items":`+items+`}`)
		}(i)
	}
	close(start)
	wg.Wait()
	close(responses)
	success := 0
	for w := range responses {
		if w.Code == 201 {
			success++
		} else if w.Code != 409 || !strings.Contains(w.Body.String(), "INSUFFICIENT_STOCK") {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
	if success != 5 {
		t.Fatalf("success=%d", success)
	}
	var minStock, maxStock, orders, items, movements int
	if err := db.QueryRow(ctx, `SELECT min(stock),max(stock),(SELECT count(*) FROM sales_orders),(SELECT count(*) FROM sales_order_items),(SELECT count(*) FROM stock_movements) FROM products`).Scan(&minStock, &maxStock, &orders, &items, &movements); err != nil {
		t.Fatal(err)
	}
	if minStock != 0 || maxStock != 0 || orders != 5 || items != 10 || movements != 10 {
		t.Fatalf("inconsistent concurrent writes: %d %d %d %d %d", minStock, maxStock, orders, items, movements)
	}
}
