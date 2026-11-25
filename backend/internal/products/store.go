package products

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type store struct{ db *pgxpool.Pool }

const columns = `p.id, p.sku, p.name, p.price, p.stock, p.is_active, p.created_at,
    (SELECT MAX(m.created_at) FROM stock_movements m WHERE m.product_id = p.id)`

func scanProduct(row pgx.Row) (Product, error) {
	var p Product
	err := row.Scan(&p.ID, &p.SKU, &p.Name, &p.Price, &p.Stock, &p.IsActive, &p.CreatedAt, &p.LastMovementAt)
	p.CreatedAt = p.CreatedAt.UTC()
	if p.LastMovementAt != nil {
		utc := p.LastMovementAt.UTC()
		p.LastMovementAt = &utc
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return p, errNotFound
	}
	return p, err
}

const predicate = `WHERE ($1 = '' OR strpos(lower(p.sku), lower($1)) > 0 OR strpos(lower(p.name), lower($1)) > 0)
    AND ($2 = 'all' OR ($2 = 'active' AND p.is_active) OR ($2 = 'inactive' AND NOT p.is_active)
    OR ($2 = 'low-stock' AND p.stock <= 10))`

func (s store) list(ctx context.Context, q Query) (List, error) {
	result := List{Data: []Product{}, Page: q.Page, Limit: q.Limit}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM products p "+predicate, q.Search, q.Filter).Scan(&result.Total); err != nil {
		return result, err
	}
	offset := (int64(q.Page) - 1) * int64(q.Limit)
	rows, err := tx.Query(ctx, "SELECT "+columns+" FROM products p "+predicate+" ORDER BY p.id LIMIT $3 OFFSET $4", q.Search, q.Filter, q.Limit, offset)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			return result, err
		}
		result.Data = append(result.Data, p)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}

func (s store) summary(ctx context.Context) (Summary, error) {
	var summary Summary
	err := s.db.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE is_active),
        COALESCE(sum(price::bigint * stock::bigint), 0), count(*) FILTER (WHERE stock <= 10) FROM products`).Scan(
		&summary.TotalProducts, &summary.ActiveProducts, &summary.TotalStockValue, &summary.LowStockCount)
	return summary, err
}

func (s store) create(ctx context.Context, in Input) (Product, error) {
	active := true
	if in.IsActive != nil {
		active = *in.IsActive
	}
	p, err := scanProduct(s.db.QueryRow(ctx, `INSERT INTO products AS p (sku, name, price, is_active)
        VALUES ($1, $2, $3, $4) RETURNING p.id, p.sku, p.name, p.price, p.stock, p.is_active, p.created_at, NULL::timestamptz`, in.SKU, in.Name, *in.Price, active))
	return p, writeError(err, false)
}

func (s store) update(ctx context.Context, id int32, in Input) (Product, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Product{}, err
	}
	defer tx.Rollback(ctx)
	var oldSKU string
	err = tx.QueryRow(ctx, "SELECT sku FROM products WHERE id=$1 FOR UPDATE", id).Scan(&oldSKU)
	if errors.Is(err, pgx.ErrNoRows) {
		return Product{}, errNotFound
	}
	if err != nil {
		return Product{}, err
	}
	if oldSKU != in.SKU {
		var referenced bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sales_order_items WHERE sku=$1)", oldSKU).Scan(&referenced); err != nil {
			return Product{}, err
		}
		if referenced {
			return Product{}, errSKUInUse
		}
	}
	_, err = tx.Exec(ctx, `UPDATE products SET sku=$2, name=$3, price=$4, is_active=COALESCE($5, is_active) WHERE id=$1`, id, in.SKU, in.Name, *in.Price, in.IsActive)
	if err != nil {
		return Product{}, writeError(err, false)
	}
	p, err := scanProduct(tx.QueryRow(ctx, "SELECT "+columns+" FROM products p WHERE p.id=$1", id))
	if err != nil {
		return Product{}, err
	}
	return p, writeError(tx.Commit(ctx), false)
}

func (s store) delete(ctx context.Context, id int32) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var sku string
	err = tx.QueryRow(ctx, "SELECT sku FROM products WHERE id=$1 FOR UPDATE", id).Scan(&sku)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}
	var history bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM stock_movements WHERE product_id=$1)", id).Scan(&history); err != nil {
		return err
	}
	if history {
		return errHasHistory
	}
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sales_order_items WHERE sku=$1)", sku).Scan(&history); err != nil {
		return err
	}
	if history {
		return errProductInUse
	}
	if _, err := tx.Exec(ctx, "DELETE FROM products WHERE id=$1", id); err != nil {
		return writeError(err, true)
	}
	return writeError(tx.Commit(ctx), true)
}

func writeError(err error, deleting bool) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return errSKUExists
		case "23503":
			if deleting {
				if pgErr.ConstraintName == "stock_movements_product_id_fkey" {
					return errHasHistory
				}
				return errProductInUse
			}
			return errSKUInUse
		}
	}
	return err
}
