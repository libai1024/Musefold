CREATE ROLE musefold_app LOGIN PASSWORD 'musefold_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE musefold_worker LOGIN PASSWORD 'musefold_worker' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT CONNECT ON DATABASE musefold TO musefold_app, musefold_worker;
GRANT CREATE ON DATABASE musefold TO musefold_worker;

ALTER ROLE musefold_app IN DATABASE musefold SET statement_timeout = '10s';
ALTER ROLE musefold_app IN DATABASE musefold SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE musefold_worker IN DATABASE musefold SET statement_timeout = '5min';
