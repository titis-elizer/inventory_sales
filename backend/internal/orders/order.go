package orders

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const maxInteger int64 = 2147483647

type ItemInput struct {
	SKU string `json:"sku"`
	Qty int32  `json:"qty"`
}

type Input struct {
	Customer string      `json:"customer"`
	Items    []ItemInput `json:"items"`
}

func (in *Input) validate() error {
	in.Customer = strings.TrimSpace(in.Customer)
	if in.Customer == "" || strings.ContainsRune(in.Customer, '\x00') {
		return errors.New("customer is required and must not contain null characters")
	}
	if len(in.Items) == 0 {
		return errors.New("items must contain at least one item")
	}
	seen := make(map[string]bool, len(in.Items))
	for i := range in.Items {
		item := &in.Items[i]
		item.SKU = strings.TrimSpace(item.SKU)
		if item.SKU == "" || strings.ContainsRune(item.SKU, '\x00') {
			return fmt.Errorf("items[%d].sku is required and must not contain null characters", i)
		}
		if item.Qty <= 0 {
			return fmt.Errorf("items[%d].qty must be a positive integer up to 2147483647", i)
		}
		if seen[item.SKU] {
			return fmt.Errorf("duplicate SKU: %s", item.SKU)
		}
		seen[item.SKU] = true
	}
	return nil
}

type Item struct {
	ID        int32  `json:"id"`
	OrderID   int32  `json:"order_id"`
	SKU       string `json:"sku"`
	Qty       int32  `json:"qty"`
	UnitPrice int32  `json:"unit_price"`
}

type Order struct {
	ID          int32      `json:"id"`
	Customer    string     `json:"customer"`
	Status      string     `json:"status"`
	Total       int32      `json:"total"`
	CreatedAt   time.Time  `json:"created_at"`
	CancelledAt *time.Time `json:"cancelled_at"`
	Items       []Item     `json:"items"`
}

type domainError struct {
	status    int
	code      string
	message   string
	sku       string
	available *int32
}

func (e *domainError) Error() string { return e.message }

func notFound() error {
	return &domainError{status: 404, code: "ORDER_NOT_FOUND", message: "Order not found"}
}

type lockedProduct struct {
	ID    int32
	SKU   string
	Price int32
	Stock int32
}
