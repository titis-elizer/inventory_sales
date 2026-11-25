package orders

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type store struct{ db *pgxpool.Pool }

// Every multi-product operation takes locks in the same ID order.
func lockProducts(ctx context.Context, tx pgx.Tx, skus []string) ([]lockedProduct, error) {
	rows, err := tx.Query(ctx, "SELECT id,sku,price,stock FROM products WHERE sku=ANY($1::text[]) ORDER BY id FOR UPDATE", skus)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	products := []lockedProduct{}
	for rows.Next() {
		var p lockedProduct
		if err := rows.Scan(&p.ID, &p.SKU, &p.Price, &p.Stock); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

func scanOrder(row pgx.Row) (Order, error) {
	o := Order{Items: []Item{}}
	err := row.Scan(&o.ID, &o.Customer, &o.Status, &o.Total, &o.CreatedAt, &o.CancelledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, notFound()
	}
	o.CreatedAt = o.CreatedAt.UTC()
	if o.CancelledAt != nil {
		utc := o.CancelledAt.UTC()
		o.CancelledAt = &utc
	}
	return o, err
}

const orderColumns = "id,customer,status,total,created_at,cancelled_at"

func readItems(ctx context.Context, tx pgx.Tx, o *Order) error {
	rows, err := tx.Query(ctx, "SELECT id,order_id,sku,qty,unit_price FROM sales_order_items WHERE order_id=$1 ORDER BY id", o.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.ID, &item.OrderID, &item.SKU, &item.Qty, &item.UnitPrice); err != nil {
			return err
		}
		o.Items = append(o.Items, item)
	}
	return rows.Err()
}

func (s store) detail(ctx context.Context, id int32) (Order, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx)
	o, err := scanOrder(tx.QueryRow(ctx, "SELECT "+orderColumns+" FROM sales_orders WHERE id=$1", id))
	if err != nil {
		return o, err
	}
	if err := readItems(ctx, tx, &o); err != nil {
		return o, err
	}
	return o, tx.Commit(ctx)
}

func (s store) create(ctx context.Context, in Input) (Order, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx)
	skus := make([]string, 0, len(in.Items))
	for _, item := range in.Items {
		skus = append(skus, item.SKU)
	}
	products, err := lockProducts(ctx, tx, skus)
	if err != nil {
		return Order{}, err
	}
	bySKU := make(map[string]lockedProduct, len(products))
	for _, p := range products {
		bySKU[p.SKU] = p
	}
	// Validate every SKU and compute totals before any INSERT/UPDATE.
	var total int64
	for _, item := range in.Items {
		p, ok := bySKU[item.SKU]
		if !ok {
			return Order{}, &domainError{status: 400, code: "UNKNOWN_SKU", message: "Unknown SKU: " + item.SKU, sku: item.SKU}
		}
		lineTotal := int64(p.Price) * int64(item.Qty)
		if lineTotal > maxInteger-total {
			return Order{}, &domainError{status: 400, code: "ORDER_TOTAL_OVERFLOW", message: "Order total must not exceed 2147483647 IDR"}
		}
		total += lineTotal
	}
	for _, item := range in.Items {
		p := bySKU[item.SKU]
		if p.Stock < item.Qty {
			available := p.Stock
			return Order{}, &domainError{status: 409, code: "INSUFFICIENT_STOCK", message: "Insufficient stock for SKU: " + item.SKU, sku: item.SKU, available: &available}
		}
	}
	o, err := scanOrder(tx.QueryRow(ctx, "INSERT INTO sales_orders(customer,total) VALUES($1,$2) RETURNING "+orderColumns, in.Customer, int32(total)))
	if err != nil {
		return o, err
	}
	for _, input := range in.Items {
		p := bySKU[input.SKU]
		item := Item{OrderID: o.ID, SKU: p.SKU, Qty: input.Qty, UnitPrice: p.Price}
		if err := tx.QueryRow(ctx, "INSERT INTO sales_order_items(order_id,sku,qty,unit_price) VALUES($1,$2,$3,$4) RETURNING id", o.ID, p.SKU, item.Qty, p.Price).Scan(&item.ID); err != nil {
			return o, err
		}
		if err := changeStock(ctx, tx, p.ID, -item.Qty, "out", item.Qty, o.ID); err != nil {
			return o, err
		}
		o.Items = append(o.Items, item)
	}
	return o, tx.Commit(ctx)
}

func changeStock(ctx context.Context, tx pgx.Tx, productID, delta int32, direction string, qty, orderID int32) error {
	if _, err := tx.Exec(ctx, "UPDATE products SET stock=stock+$2 WHERE id=$1", productID, delta); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO stock_movements(product_id,type,qty,note,created_at) VALUES($1,$2,$3,$4,clock_timestamp())`, productID, direction, qty, fmt.Sprintf("Sales order #%d: %s", orderID, direction))
	return err
}

func (s store) cancel(ctx context.Context, id int32) (Order, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx)
	o, err := scanOrder(tx.QueryRow(ctx, "SELECT "+orderColumns+" FROM sales_orders WHERE id=$1 FOR UPDATE", id))
	if err != nil {
		return o, err
	}
	if o.Status == "CANCELLED" {
		return o, &domainError{status: 409, code: "ORDER_ALREADY_CANCELLED", message: "Order is already cancelled"}
	}
	if err := readItems(ctx, tx, &o); err != nil {
		return o, err
	}
	skus := make([]string, 0, len(o.Items))
	quantities := map[string]int64{}
	for _, item := range o.Items {
		skus = append(skus, item.SKU)
		quantities[item.SKU] += int64(item.Qty)
	}
	products, err := lockProducts(ctx, tx, skus)
	if err != nil {
		return o, err
	}
	if len(products) != len(quantities) {
		return o, errors.New("order references missing product")
	}
	for _, p := range products {
		if int64(p.Stock)+quantities[p.SKU] > maxInteger {
			return o, &domainError{status: 409, code: "STOCK_LIMIT_EXCEEDED", message: "Cancellation would exceed stock limit for SKU: " + p.SKU, sku: p.SKU}
		}
	}
	for _, p := range products {
		qty := int32(quantities[p.SKU])
		if err := changeStock(ctx, tx, p.ID, qty, "in", qty, o.ID); err != nil {
			return o, err
		}
	}
	updated, err := scanOrder(tx.QueryRow(ctx, "UPDATE sales_orders SET status='CANCELLED',cancelled_at=clock_timestamp() WHERE id=$1 RETURNING "+orderColumns, id))
	if err != nil {
		return o, err
	}
	updated.Items = o.Items
	return updated, tx.Commit(ctx)
}
