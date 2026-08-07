-- Creates the runtime application role.
--
-- Runs once, on an empty data directory, as isipheko_owner. Testcontainers
-- mounts this same file, so the test database and the development database
-- start from an identical privilege position — which is the only way the
-- append-only test proves anything about production.
--
-- No grants here. Every privilege isipheko_app holds is issued by migration
-- SQL, so the privileges are versioned alongside the schema they apply to and a
-- new table cannot quietly arrive with the wrong access.

CREATE ROLE isipheko_app WITH LOGIN PASSWORD 'isipheko_local_dev';

-- Connect and see the schema; nothing else yet.
GRANT CONNECT ON DATABASE isipheko TO isipheko_app;
GRANT USAGE ON SCHEMA public TO isipheko_app;

-- Postgres 15 and later already revoke this, but being explicit costs nothing
-- and states the intent: the application role does not create tables.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM isipheko_app;
