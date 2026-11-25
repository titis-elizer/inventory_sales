package products

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func stockRequest(mux http.Handler, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

func TestStockAPI(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	Register(mux, db)
	var id int32
	if err := db.QueryRow(ctx, "INSERT INTO products(sku,name,price) VALUES ('STOCK','Stock Test',1000) RETURNING id").Scan(&id); err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/products/%d", id)
	request := func(method, route, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := stockRequest(mux, method, route, body)
		if w.Code != status {
			t.Fatalf("%s %s: want %d got %d: %s", method, route, status, w.Code, w.Body.String())
		}
		return w
	}
	assertState := func(stock, count int) {
		t.Helper()
		var gotStock, gotCount int
		err := db.QueryRow(ctx, `SELECT stock,(SELECT count(*) FROM stock_movements WHERE product_id=$1) FROM products WHERE id=$1`, id).Scan(&gotStock, &gotCount)
		if err != nil || gotStock != stock || gotCount != count {
			t.Fatalf("state=(%d,%d), want (%d,%d), err=%v", gotStock, gotCount, stock, count, err)
		}
	}
	if w := request("GET", path+"/movements", "", 200); !strings.Contains(w.Body.String(), `"data":[]`) {
		t.Fatal("empty history must be an array")
	}
	w := request("POST", path+"/stock", `{"type":"in","qty":10,"note":"Initial delivery"}`, 200)
	var result AdjustmentResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Product.Stock != 10 || result.Movement.Type != "in" || result.Movement.Qty != 10 || result.Movement.Note == nil || *result.Movement.Note != "Initial delivery" {
		t.Fatalf("unexpected result: %s", w.Body.String())
	}
	assertState(10, 1)
	request("POST", path+"/stock", `{"type":"out","qty":4,"note":"Damaged"}`, 200)
	assertState(6, 2)
	w = request("POST", path+"/stock", `{"type":"out","qty":7}`, 409)
	var envelope struct {
		Error struct {
			Code      string `json:"code"`
			Available *int32 `json:"available"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != "INSUFFICIENT_STOCK" || envelope.Error.Available == nil || *envelope.Error.Available != 6 {
		t.Fatalf("incorrect conflict: %s", w.Body.String())
	}
	assertState(6, 2)
	for _, body := range []string{
		`{"type":"in","qty":0}`, `{"type":"in","qty":-1}`, `{"type":"in","qty":1.5}`,
		`{"type":"unknown","qty":1}`, `{"type":"in","qty":"1"}`, `{"type":"out"}`,
		`{"qty":1}`, `{"type":"in","qty":null}`, `{"type":"in","qty":2147483648}`,
		`{"type":"in","qty":1,"note":42}`, `{"type":"in","qty":1,"stock":99}`,
	} {
		request("POST", path+"/stock", body, 400)
		assertState(6, 2)
	}
	request("POST", "/api/products/2147483647/stock", `{"type":"in","qty":1}`, 404)
	request("GET", "/api/products/2147483647/movements", "", 404)
	request("POST", "/api/products/abc/stock", `{"type":"in","qty":1}`, 400)
	request("GET", "/api/products/abc/movements", "", 400)
	w = request("GET", path+"/movements", "", 200)
	var history struct {
		Data []Movement `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Data) != 2 || history.Data[0].Type != "out" || history.Data[1].Type != "in" || history.Data[0].CreatedAt.Before(history.Data[1].CreatedAt) {
		t.Fatalf("history not newest first: %s", w.Body.String())
	}
	request("POST", path+"/stock", `{"type":"in","qty":2147483647}`, 409)
	assertState(6, 2)
	// Force movement insertion failure after UPDATE: stock must roll back too.
	if _, err := db.Exec(ctx, `ALTER TABLE stock_movements ADD CONSTRAINT test_reject_note CHECK (note IS DISTINCT FROM 'reject-insert')`); err != nil {
		t.Fatal(err)
	}
	request("POST", path+"/stock", `{"type":"in","qty":2,"note":"reject-insert"}`, 500)
	assertState(6, 2)
}

func TestConcurrentStockOut(t *testing.T) {
	db := testDatabase(t)
	ctx := context.Background()
	mux := http.NewServeMux()
	Register(mux, db)
	var id int32
	if err := db.QueryRow(ctx, "INSERT INTO products(sku,name,price) VALUES ('CONCURRENT','Concurrent Test',1) RETURNING id").Scan(&id); err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/products/%d/stock", id)
	if w := stockRequest(mux, "POST", path, `{"type":"in","qty":5}`); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	const requests = 16
	start := make(chan struct{})
	responses := make(chan *httptest.ResponseRecorder, requests)
	var wg sync.WaitGroup
	for i := 0; i < requests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			responses <- stockRequest(mux, "POST", path, `{"type":"out","qty":1}`)
		}()
	}
	close(start)
	wg.Wait()
	close(responses)
	successes, conflicts := 0, 0
	for w := range responses {
		switch w.Code {
		case 200:
			successes++
		case 409:
			conflicts++
			if !strings.Contains(w.Body.String(), `"code":"INSUFFICIENT_STOCK"`) || !strings.Contains(w.Body.String(), `"available":0`) {
				t.Errorf("incorrect conflict: %s", w.Body.String())
			}
		default:
			t.Errorf("unexpected status %d: %s", w.Code, w.Body.String())
		}
	}
	if successes != 5 || conflicts != requests-5 {
		t.Fatalf("successes=%d conflicts=%d", successes, conflicts)
	}
	var stock, movements int
	if err := db.QueryRow(ctx, `SELECT stock,(SELECT count(*) FROM stock_movements WHERE product_id=$1 AND type='out') FROM products WHERE id=$1`, id).Scan(&stock, &movements); err != nil {
		t.Fatal(err)
	}
	if stock != 0 || movements != 5 {
		t.Fatalf("stock=%d movements=%d", stock, movements)
	}
}
