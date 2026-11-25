package products

import (
	"net/url"
	"testing"
)

func TestQueryValidation(t *testing.T) {
	for _, raw := range []string{"page=0", "page=-1", "page=abc", "page=2147483648", "limit=101", "limit=0", "limit=", "page=1&page=2", "filter=other", "unknown=1"} {
		t.Run(raw, func(t *testing.T) {
			values, _ := url.ParseQuery(raw)
			if _, err := parseQuery(values); err == nil {
				t.Fatal("expected invalid query")
			}
		})
	}
	q, err := parseQuery(url.Values{})
	if err != nil || q.Page != 1 || q.Limit != 20 || q.Filter != "all" {
		t.Fatalf("unexpected defaults: %+v %v", q, err)
	}
	for _, filter := range []string{"all", "active", "inactive", "low-stock"} {
		if _, err := parseQuery(url.Values{"filter": {filter}}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestInputValidation(t *testing.T) {
	zero, negative := int32(0), int32(-1)
	for _, in := range []Input{{Name: "Name", Price: &zero}, {SKU: "A", Price: &zero}, {SKU: "A", Name: "Name"}, {SKU: "A", Name: "Name", Price: &negative}, {SKU: "A\x00", Name: "Name", Price: &zero}} {
		if in.validate() == nil {
			t.Fatalf("expected invalid input: %+v", in)
		}
	}
	in := Input{SKU: " A ", Name: " Name ", Price: &zero}
	if in.validate() != nil || in.SKU != "A" || in.Name != "Name" {
		t.Fatal("normalization or zero price failed")
	}
}
