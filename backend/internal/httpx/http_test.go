package httpx

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecode(t *testing.T) {
	for _, body := range []string{"", "null", "[]", "{", `{} {}`, `{"price":"1"}`, `{"price":1.5}`, `{"price":null}`, `{"stock":2}`, `{"price":2147483648}`} {
		t.Run(body, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/", strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			var target struct {
				Price *int32 `json:"price"`
			}
			if Decode(w, r, &target) || w.Code != 400 {
				t.Fatalf("unexpected response %d: %s", w.Code, w.Body.String())
			}
		})
	}
	t.Run("media type", func(t *testing.T) {
		w := httptest.NewRecorder()
		if Decode(w, httptest.NewRequest("POST", "/", strings.NewReader("{}")), &struct{}{}) || w.Code != 415 {
			t.Fatal("expected 415")
		}
	})
	t.Run("size limit", func(t *testing.T) {
		r := httptest.NewRequest("POST", "/", strings.NewReader(`{"value":"`+strings.Repeat("x", 1<<20)+`"}`))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		if Decode(w, r, &struct{}{}) || w.Code != 413 {
			t.Fatalf("expected 413, got %d", w.Code)
		}
	})
}
