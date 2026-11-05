-- Count consecutive failed authentication attempts, not successful cashier re-entry.
CREATE FUNCTION login_succeeded(p_key text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DELETE FROM public.login_attempts WHERE key=p_key
$$;
REVOKE ALL ON FUNCTION login_succeeded(text) FROM PUBLIC;
