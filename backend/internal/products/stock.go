package products

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"inventory-and-sales/backend/internal/httpx"
)

type Adjustment struct {
	Type string `json:"type"`
	Qty  int32  `json:"qty"`
	Note string `json:"note"`
}

func (a Adjustment) validate() error {
	if a.Type != "in" && a.Type != "out" {
		return errors.New("type must be in or out")
	}
	if a.Qty <= 0 {
		return errors.New("qty must be a positive integer up to 2147483647")
	}
	if strings.ContainsRune(a.Note, '\x00') {
		return errors.New("note must not contain null characters")
	}
	return nil
}

type Movement struct {
	ID        int32     `json:"id"`
	ProductID int32     `json:"product_id"`
	Type      string    `json:"type"`
	Qty       int32     `json:"qty"`
	Note      *string   `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type AdjustmentResult struct {
	Product  Product  `json:"product"`
	Movement Movement `json:"movement"`
}

type insufficientStock struct{ available int32 }

func (e *insufficientStock) Error() string { return "insufficient stock" }

var errStockOverflow = errors.New("stock exceeds integer range")

func registerStock(mux *http.ServeMux, s store) {
	mux.HandleFunc("POST /api/products/{id}/stock", func(w http.ResponseWriter, r *http.Request) {
		id, ok := readID(w, r)
		if !ok {
			return
		}
		var in Adjustment
		if !httpx.Decode(w, r, &in) {
			return
		}
		if err := in.validate(); err != nil {
			httpx.Fail(w, 400, "VALIDATION_ERROR", err.Error())
			return
		}
		result, err := s.adjust(r.Context(), id, in)
		var insufficient *insufficientStock
		switch {
		case errors.As(err, &insufficient):
			httpx.InsufficientStock(w, insufficient.available)
		case errors.Is(err, errStockOverflow):
			httpx.Fail(w, 409, "STOCK_LIMIT_EXCEEDED", "Resulting stock exceeds 2147483647")
		case err != nil:
			respondError(w, err)
		default:
			httpx.JSON(w, http.StatusOK, result)
		}
	})
	mux.HandleFunc("GET /api/products/{id}/movements", func(w http.ResponseWriter, r *http.Request) {
		id, ok := readID(w, r)
		if !ok {
			return
		}
		movements, err := s.movements(r.Context(), id)
		if err != nil {
			respondError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, struct {
			Data []Movement `json:"data"`
		}{movements})
	})
}

func (s store) adjust(ctx context.Context, id int32, in Adjustment) (AdjustmentResult, error) {
	var result AdjustmentResult
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	// This lock serializes adjustments with each other and with product update/delete.
	var stock int32
	err = tx.QueryRow(ctx, "SELECT stock FROM products WHERE id=$1 FOR UPDATE", id).Scan(&stock)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, errNotFound
	}
	if err != nil {
		return result, err
	}
	delta := int64(in.Qty)
	if in.Type == "out" {
		if stock < in.Qty {
			return result, &insufficientStock{stock}
		}
		delta = -delta
	}
	if int64(stock)+delta > 2147483647 {
		return result, errStockOverflow
	}
	if _, err := tx.Exec(ctx, "UPDATE products SET stock=stock+$2 WHERE id=$1", id, int32(delta)); err != nil {
		return result, err
	}
	m := &result.Movement
	err = tx.QueryRow(ctx, `INSERT INTO stock_movements(product_id,type,qty,note,created_at)
        VALUES ($1,$2,$3,$4,clock_timestamp()) RETURNING id,product_id,type,qty,note,created_at`, id, in.Type, in.Qty, in.Note).Scan(
		&m.ID, &m.ProductID, &m.Type, &m.Qty, &m.Note, &m.CreatedAt)
	if err != nil {
		return result, err
	}
	m.CreatedAt = m.CreatedAt.UTC()
	result.Product, err = scanProduct(tx.QueryRow(ctx, "SELECT "+columns+" FROM products p WHERE p.id=$1", id))
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}

func (s store) movements(ctx context.Context, id int32) ([]Movement, error) {
	data := []Movement{}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM products WHERE id=$1)", id).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, errNotFound
	}
	rows, err := tx.Query(ctx, `SELECT id,product_id,type,qty,note,created_at FROM stock_movements
        WHERE product_id=$1 ORDER BY created_at DESC,id DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m Movement
		if err := rows.Scan(&m.ID, &m.ProductID, &m.Type, &m.Qty, &m.Note, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.CreatedAt = m.CreatedAt.UTC()
		data = append(data, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return data, tx.Commit(ctx)
}
