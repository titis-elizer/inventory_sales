package orders

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"inventory-and-sales/backend/internal/httpx"
)

func Register(mux *http.ServeMux, db *pgxpool.Pool) {
	s := store{db}
	mux.HandleFunc("POST /api/orders", func(w http.ResponseWriter, r *http.Request) {
		var in Input
		if !httpx.Decode(w, r, &in) {
			return
		}
		if err := in.validate(); err != nil {
			httpx.Fail(w, 400, "VALIDATION_ERROR", err.Error())
			return
		}
		o, err := s.create(r.Context(), in)
		if err != nil {
			respondError(w, err)
			return
		}
		w.Header().Set("Location", "/api/orders/"+strconv.Itoa(int(o.ID)))
		httpx.JSON(w, http.StatusCreated, o)
	})
	mux.HandleFunc("GET /api/orders/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := readID(w, r)
		if !ok {
			return
		}
		o, err := s.detail(r.Context(), id)
		if err != nil {
			respondError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, o)
	})
	mux.HandleFunc("POST /api/orders/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		id, ok := readID(w, r)
		if !ok {
			return
		}
		o, err := s.cancel(r.Context(), id)
		if err != nil {
			respondError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, o)
	})
}

func readID(w http.ResponseWriter, r *http.Request) (int32, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 32)
	if err != nil || id < 1 {
		httpx.Fail(w, 400, "INVALID_ID", "Order ID must be a positive integer")
		return 0, false
	}
	return int32(id), true
}

func respondError(w http.ResponseWriter, err error) {
	var domain *domainError
	if !errors.As(err, &domain) {
		httpx.Internal(w, err)
		return
	}
	httpx.JSON(w, domain.status, struct {
		Error httpx.Error `json:"error"`
	}{
		httpx.Error{Code: domain.code, Message: domain.message, SKU: domain.sku, Available: domain.available},
	})
}
