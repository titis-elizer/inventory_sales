package products

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"inventory-and-sales/backend/internal/httpx"
)

func Register(mux *http.ServeMux, db *pgxpool.Pool) {
	s := store{db}
	mux.HandleFunc("GET /api/products", func(w http.ResponseWriter, r *http.Request) {
		q, err := parseQuery(r.URL.Query())
		if err != nil {
			httpx.Fail(w, 400, "INVALID_QUERY", err.Error())
			return
		}
		result, err := s.list(r.Context(), q)
		if err != nil {
			respondError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("GET /api/products/summary", func(w http.ResponseWriter, r *http.Request) {
		result, err := s.summary(r.Context())
		if err != nil {
			respondError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, result)
	})
	mux.HandleFunc("POST /api/products", func(w http.ResponseWriter, r *http.Request) {
		in, ok := readInput(w, r)
		if !ok {
			return
		}
		p, err := s.create(r.Context(), in)
		if err != nil {
			respondError(w, err)
			return
		}
		w.Header().Set("Location", "/api/products/"+strconv.Itoa(int(p.ID)))
		httpx.JSON(w, http.StatusCreated, p)
	})
	mux.HandleFunc("PUT /api/products/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := readID(w, r)
		if !ok {
			return
		}
		in, ok := readInput(w, r)
		if !ok {
			return
		}
		p, err := s.update(r.Context(), id, in)
		if err != nil {
			respondError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, p)
	})
	mux.HandleFunc("DELETE /api/products/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := readID(w, r)
		if !ok {
			return
		}
		if err := s.delete(r.Context(), id); err != nil {
			respondError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func readInput(w http.ResponseWriter, r *http.Request) (Input, bool) {
	var in Input
	if !httpx.Decode(w, r, &in) {
		return in, false
	}
	if err := in.validate(); err != nil {
		httpx.Fail(w, 400, "VALIDATION_ERROR", err.Error())
		return in, false
	}
	return in, true
}

func readID(w http.ResponseWriter, r *http.Request) (int32, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 32)
	if err != nil || id < 1 {
		httpx.Fail(w, 400, "INVALID_ID", "Product ID must be a positive integer")
		return 0, false
	}
	return int32(id), true
}

func respondError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotFound):
		httpx.Fail(w, 404, "PRODUCT_NOT_FOUND", "Product not found")
	case errors.Is(err, errSKUExists):
		httpx.Fail(w, 409, "SKU_EXISTS", "SKU already exists")
	case errors.Is(err, errSKUInUse):
		httpx.Fail(w, 409, "SKU_IN_USE", "SKU cannot be changed because it is referenced by an order")
	case errors.Is(err, errHasHistory):
		httpx.Fail(w, 409, "PRODUCT_HAS_HISTORY", "Product has movement history and cannot be deleted")
	case errors.Is(err, errProductInUse):
		httpx.Fail(w, 409, "PRODUCT_IN_USE", "Product is referenced by an order and cannot be deleted")
	default:
		httpx.Internal(w, err)
	}
}
