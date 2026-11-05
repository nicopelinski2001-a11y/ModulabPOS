-- All money postings, including accidental SQL, serialize with closure of a shift.
CREATE FUNCTION guard_cash_posting() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE shift public.cash_shifts; balance bigint;
BEGIN
 SELECT * INTO shift FROM public.cash_shifts WHERE tenant_id=NEW.tenant_id AND id=NEW.shift_id FOR UPDATE;
 IF shift.id IS NULL OR shift.closed_at IS NOT NULL OR shift.user_id<>NEW.user_id THEN
 RAISE EXCEPTION 'La caja no está abierta para este empleado' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='cash_movements' AND NEW.amount_cents<0 THEN
 SELECT shift.opening_cents+coalesce(sum(amount_cents),0) INTO balance FROM public.cash_movements WHERE tenant_id=NEW.tenant_id AND shift_id=NEW.shift_id;
 IF balance+NEW.amount_cents<0 THEN RAISE EXCEPTION 'Efectivo insuficiente en caja' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cash_posting BEFORE INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION guard_cash_posting();
-- A separate function avoids field access against different trigger record types.
CREATE FUNCTION guard_sale_shift() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE shift public.cash_shifts;
BEGIN
 SELECT * INTO shift FROM public.cash_shifts WHERE tenant_id=NEW.tenant_id AND id=NEW.shift_id FOR UPDATE;
 IF shift.id IS NULL OR shift.closed_at IS NOT NULL OR shift.user_id<>NEW.user_id THEN
 RAISE EXCEPTION 'La caja no está abierta para este empleado' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sale_shift BEFORE INSERT ON sales FOR EACH ROW EXECUTE FUNCTION guard_sale_shift();
CREATE TRIGGER return_shift BEFORE INSERT ON sale_returns FOR EACH ROW EXECUTE FUNCTION guard_sale_shift();
CREATE FUNCTION check_shift_close() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE expected bigint;
BEGIN
 SELECT NEW.opening_cents+coalesce(sum(amount_cents),0) INTO expected FROM public.cash_movements WHERE tenant_id=NEW.tenant_id AND shift_id=NEW.id;
 IF NEW.expected_cents IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Arqueo inconsistente' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shift_reconciliation BEFORE UPDATE ON cash_shifts FOR EACH ROW EXECUTE FUNCTION check_shift_close();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
