package config

import "testing"

func TestLoad(t *testing.T) {
	for _, tt := range []struct {
		name, port, url string
		valid           bool
	}{
		{"default port", "", "postgres://user:pass@localhost:5432/stockflow", true},
		{"custom port", "9000", "postgresql://localhost/stockflow", true},
		{"missing database", "8080", "", false},
		{"wrong scheme", "8080", "https://localhost/stockflow", false},
		{"no database name", "8080", "postgres://localhost", false},
		{"invalid port", "abc", "postgres://localhost/stockflow", false},
		{"out of range", "65536", "postgres://localhost/stockflow", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("PORT", tt.port)
			t.Setenv("DATABASE_URL", tt.url)
			cfg, err := Load()
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%v, error=%v", tt.valid, err)
			}
			if tt.valid && tt.port == "" && cfg.Port != "8080" {
				t.Fatal("wrong default port")
			}
		})
	}
}
