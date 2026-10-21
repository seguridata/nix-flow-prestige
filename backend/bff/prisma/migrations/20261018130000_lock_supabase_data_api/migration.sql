-- Prestige accede a Postgres solo por el BFF (Prisma, rol dueño `postgres`, que ignora RLS).
-- Supabase, en cambio, publica el esquema `public` por su API de datos con los roles `anon`
-- y `authenticated`: sin esta migración, quien tenga la clave pública podría leer o modificar
-- todas las tablas. Se activa RLS (sin políticas: ningún rol de la API ve filas) y se
-- revocan los permisos de esos roles, también por defecto para tablas futuras.
-- En un Postgres sin esos roles (desarrollo local) solo se activa RLS, que no afecta al dueño.
-- Idempotente.

DO $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;

-- Función del trigger de inmutabilidad: solo usa OLD/NEW y funciones internas, así que se fija
-- un search_path vacío (aviso `function_search_path_mutable` del asesor de Supabase).
ALTER FUNCTION public.prestige_audit_event_immutable() SET search_path = '';
