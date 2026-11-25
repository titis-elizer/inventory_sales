package products

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Product struct {
	ID             int32      `json:"id"`
	SKU            string     `json:"sku"`
	Name           string     `json:"name"`
	Price          int32      `json:"price"`
	Stock          int32      `json:"stock"`
	IsActive       bool       `json:"is_active"`
	CreatedAt      time.Time  `json:"created_at"`
	LastMovementAt *time.Time `json:"last_movement_at"`
}

type Input struct {
	SKU      string `json:"sku"`
	Name     string `json:"name"`
	Price    *int32 `json:"price"`
	IsActive *bool  `json:"is_active"`
}

func (in *Input) validate() error {
	in.SKU, in.Name = strings.TrimSpace(in.SKU), strings.TrimSpace(in.Name)
	if in.SKU == "" {
		return errors.New("sku is required")
	}
	if in.Name == "" {
		return errors.New("name is required")
	}
	if strings.ContainsRune(in.SKU, '\x00') || strings.ContainsRune(in.Name, '\x00') {
		return errors.New("sku and name must not contain null characters")
	}
	if in.Price == nil || *in.Price < 0 {
		return errors.New("price is required and must be an integer between 0 and 2147483647")
	}
	return nil
}

type Query struct {
	Search string
	Page   int
	Limit  int
	Filter string
}

func parseQuery(values url.Values) (Query, error) {
	q := Query{Page: 1, Limit: 20, Filter: "all", Search: strings.TrimSpace(values.Get("search"))}
	for key, entries := range values {
		if key != "search" && key != "page" && key != "limit" && key != "filter" {
			return q, errors.New("unknown query parameter")
		}
		if len(entries) != 1 {
			return q, errors.New("query parameters must not be repeated")
		}
	}
	for _, item := range []struct {
		key    string
		target *int
		max    int
	}{
		{"page", &q.Page, 2147483647}, {"limit", &q.Limit, 100},
	} {
		if values.Has(item.key) {
			n, err := strconv.Atoi(values.Get(item.key))
			if err != nil || n < 1 || n > item.max {
				return q, errors.New(item.key + " is outside the allowed range")
			}
			*item.target = n
		}
	}
	if values.Has("filter") {
		q.Filter = values.Get("filter")
	}
	switch q.Filter {
	case "all", "active", "inactive", "low-stock":
	default:
		return q, errors.New("filter must be all, active, inactive, or low-stock")
	}
	if strings.ContainsRune(q.Search, '\x00') {
		return q, errors.New("search must not contain null characters")
	}
	return q, nil
}

type List struct {
	Data  []Product `json:"data"`
	Page  int       `json:"page"`
	Limit int       `json:"limit"`
	Total int64     `json:"total"`
}

type Summary struct {
	TotalProducts   int64 `json:"total_products"`
	ActiveProducts  int64 `json:"active_products"`
	TotalStockValue int64 `json:"total_stock_value"`
	LowStockCount   int64 `json:"low_stock_count"`
}

var (
	errNotFound     = errors.New("product not found")
	errSKUExists    = errors.New("sku already exists")
	errSKUInUse     = errors.New("sku is referenced by an order")
	errHasHistory   = errors.New("product has movement history")
	errProductInUse = errors.New("product is referenced by an order")
)
