\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(78234101);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 1) AS apply_v1 \gset
\if :apply_v1
\ir ../migrations/001_init.sql
INSERT INTO schema_migrations (version) VALUES (1);
\endif

\ir ../seeds/002_demo.sql
COMMIT;