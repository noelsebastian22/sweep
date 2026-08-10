-- pg_net was created in the public schema by migration 13. The security
-- advisor flags any extension installed in public, and pg_net doesn't
-- support `set schema` on an existing install, so drop and recreate it in
-- the existing `extensions` schema (already home to pgcrypto, uuid-ossp).
-- Nothing depends on pg_net yet (Weekend 2 is the first consumer).
drop extension if exists pg_net;
create extension if not exists pg_net with schema extensions;
