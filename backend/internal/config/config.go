package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
)

type Config struct {
	Port        string
	DatabaseURL string
}

func Load() (Config, error) {
	cfg := Config{Port: os.Getenv("PORT"), DatabaseURL: os.Getenv("DATABASE_URL")}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	port, err := strconv.Atoi(cfg.Port)
	if err != nil || port < 1 || port > 65535 {
		return Config{}, errors.New("PORT must be an integer between 1 and 65535")
	}
	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil || parsed == nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Hostname() == "" || parsed.Path == "" || parsed.Path == "/" {
		return Config{}, errors.New("DATABASE_URL must be a PostgreSQL URL with host and database name")
	}
	return cfg, nil
}
